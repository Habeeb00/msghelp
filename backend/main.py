from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from together import Together
import os
from typing import Optional, List, Dict
import uuid
from datetime import datetime, timedelta
import hashlib
import json

# LangGraph imports
from langgraph.graph import StateGraph, END
from typing_extensions import TypedDict

from dotenv import load_dotenv
load_dotenv()

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Together AI
client = Together(api_key=os.getenv("TOGETHER_API_KEY"))
FINE_TUNED_MODEL = os.getenv("FINE_TUNED_MODEL", "your-fine-tuned-model-id")

# In-memory storage (use Redis in production)
sessions = {}
reply_cache = {}

CONFIG = {
    "CONTEXT_WINDOW": 4,  # Last 4 messages as context
    "CACHE_TTL": 600,  # 10 minutes
    "SESSION_TTL": 3600,  # 1 hour
    "MAX_TOKENS": 512,
}


# State definition
class ReplySuggestionState(TypedDict):
    current_message: Dict
    context_messages: List[Dict]
    conversation_history: List[Dict]
    reply_suggestion: str


# Pydantic models
class ContextMessage(BaseModel):
    text: str
    type: str  # "incoming" or "outgoing"
    timestamp: int


class CurrentMessage(BaseModel):
    text: str
    platform: str = "unknown"
    timestamp: int


class SuggestReplyRequest(BaseModel):
    current_message: CurrentMessage
    context_messages: List[ContextMessage]  # Last 4 messages
    session_id: Optional[str] = None


class SuggestReplyResponse(BaseModel):
    suggestion: str
    session_id: str
    cached: bool = False


class GeneralReplyRequest(BaseModel):
    current_message: CurrentMessage
    context_messages: List[ContextMessage]  # Last 4 messages
    session_id: Optional[str] = None


class GeneralReplyResponse(BaseModel):
    suggestion: str
    session_id: str
    model_used: str
    cached: bool = False


# Cache helpers
def get_cache_key(current_msg: str, context: List[Dict]) -> str:
    """Generate cache key from current message + context"""
    context_str = "|".join([f"{m['type']}:{m['text']}" for m in context])
    content = f"{current_msg}::{context_str}"
    return hashlib.md5(content.encode()).hexdigest()


def get_from_cache(key: str) -> Optional[str]:
    """Get cached reply suggestion"""
    if key in reply_cache:
        cached = reply_cache[key]
        if datetime.now().timestamp() - cached["timestamp"] < CONFIG["CACHE_TTL"]:
            return cached["suggestion"]
        else:
            del reply_cache[key]
    return None


def set_cache(key: str, suggestion: str):
    """Cache reply suggestion"""
    reply_cache[key] = {
        "suggestion": suggestion,
        "timestamp": datetime.now().timestamp()
    }
    
    # Clean old entries if cache too large
    if len(reply_cache) > 100:
        cleanup_cache()


def cleanup_cache():
    """Remove expired cache entries"""
    now = datetime.now().timestamp()
    expired = [
        k for k, v in reply_cache.items()
        if now - v["timestamp"] > CONFIG["CACHE_TTL"]
    ]
    for k in expired:
        del reply_cache[k]


# Session management
def get_session(session_id: str) -> Optional[Dict]:
    """Get session state"""
    if session_id in sessions:
        session = sessions[session_id]
        # Check if expired
        if datetime.now().timestamp() - session["last_activity"] < CONFIG["SESSION_TTL"]:
            return session
        else:
            del sessions[session_id]
    return None


def save_session(session_id: str, state: Dict):
    """Save session state"""
    sessions[session_id] = {
        "state": state,
        "last_activity": datetime.now().timestamp()
    }


# LangGraph Nodes
def build_conversation_node(state: ReplySuggestionState) -> ReplySuggestionState:
    """Build the conversation history for the model"""
    context_messages = state["context_messages"]
    current_message = state["current_message"]
    
    # Build conversation history: context messages + current message
    conversation = []
    
    # Add context messages (oldest to newest)
    for msg in reversed(context_messages):
        role = "assistant" if msg["type"] == "outgoing" else "user"
        conversation.append({
            "role": role,
            "content": msg["text"]
        })
    
    # Add current message (the one we need to reply to)
    conversation.append({
        "role": "user",
        "content": current_message["text"]
    })
    
    return {
        **state,
        "conversation_history": conversation
    }


def generate_reply_node(state: ReplySuggestionState) -> ReplySuggestionState:
    """Generate reply suggestion using fine-tuned model"""
    conversation_history = state["conversation_history"]
    
    try:
        # Add system prompt for better context
        messages = [
            {
                "role": "system",
                "content": "You are a helpful assistant that suggests appropriate replies to messages. Provide a natural, contextual response."
            }
        ] + conversation_history
        
        # Call fine-tuned model
        response = client.chat.completions.create(
            model=FINE_TUNED_MODEL,
            messages=messages,
            max_tokens=CONFIG["MAX_TOKENS"],
            temperature=0.7,
            top_p=0.9,
        )
        
        reply_suggestion = response.choices[0].message.content.strip()
        
    except Exception as e:
        raise Exception(f"Model inference failed: {str(e)}")
    
    return {
        **state,
        "reply_suggestion": reply_suggestion
    }


# Create LangGraph workflow
def create_reply_graph():
    """Create the reply suggestion workflow"""
    workflow = StateGraph(ReplySuggestionState)
    
    workflow.add_node("build_conversation", build_conversation_node)
    workflow.add_node("generate_reply", generate_reply_node)
    
    workflow.set_entry_point("build_conversation")
    workflow.add_edge("build_conversation", "generate_reply")
    workflow.add_edge("generate_reply", END)
    
    return workflow.compile()


reply_graph = create_reply_graph()


@app.post("/suggest-reply", response_model=SuggestReplyResponse)
async def suggest_reply(request: SuggestReplyRequest, background_tasks: BackgroundTasks):
    """
    Generate reply suggestion for current message using last 4 messages as context.
    
    Flow:
    1. Receives current incoming message + last 4 messages as context
    2. Builds conversation history
    3. Calls fine-tuned model to generate appropriate reply
    4. Returns suggested reply text
    """
    
    # Validate context window
    if len(request.context_messages) > CONFIG["CONTEXT_WINDOW"]:
        raise HTTPException(
            status_code=400,
            detail=f"Context messages exceed maximum of {CONFIG['CONTEXT_WINDOW']}"
        )
    
    # Get or create session
    session_id = request.session_id or str(uuid.uuid4())
    session_state = get_session(session_id)
    
    # Check cache
    cache_key = get_cache_key(
        request.current_message.text,
        [m.dict() for m in request.context_messages]
    )
    
    cached_suggestion = get_from_cache(cache_key)
    if cached_suggestion:
        print(f"[CACHE HIT] for session {session_id}")
        return SuggestReplyResponse(
            suggestion=cached_suggestion,
            session_id=session_id,
            cached=True
        )
    
    print(f"[PROCESSING] Message with {len(request.context_messages)} context messages")
    
    try:
        # Prepare state for LangGraph
        initial_state: ReplySuggestionState = {
            "current_message": request.current_message.dict(),
            "context_messages": [m.dict() for m in request.context_messages],
            "conversation_history": [],
            "reply_suggestion": ""
        }
        
        # Run through workflow
        result = reply_graph.invoke(initial_state)
        
        reply_suggestion = result["reply_suggestion"]
        
        # Cache the result
        background_tasks.add_task(set_cache, cache_key, reply_suggestion)
        
        # Update session
        if session_state:
            session_state["state"] = result
        else:
            session_state = {"state": result}
        
        background_tasks.add_task(save_session, session_id, session_state)
        
        print(f"[SUCCESS] Generated reply for session {session_id}")
        
        return SuggestReplyResponse(
            suggestion=reply_suggestion,
            session_id=session_id,
            cached=False
        )
        
    except Exception as e:
        print(f"[ERROR] {str(e)}")
        
        # Handle rate limits
        if "rate limit" in str(e).lower():
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please try again in a moment."
            )
        
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate reply: {str(e)}"
        )


@app.post("/suggest-reply-general", response_model=GeneralReplyResponse)
async def suggest_reply_general(request: GeneralReplyRequest, background_tasks: BackgroundTasks):
    """
    Generate reply suggestion using a GENERAL LLM (not fine-tuned).
    Same format as /suggest-reply but uses general model like Llama 3.1.
    
    Flow:
    1. Receives current incoming message + last 4 messages as context
    2. Builds conversation history
    3. Calls GENERAL LLM to generate appropriate reply
    4. Returns suggested reply text
    """
    
    # Use general model
    GENERAL_MODEL = os.getenv("GENERAL_MODEL", "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo")
    
    # Validate context window
    if len(request.context_messages) > CONFIG["CONTEXT_WINDOW"]:
        raise HTTPException(
            status_code=400,
            detail=f"Context messages exceed maximum of {CONFIG['CONTEXT_WINDOW']}"
        )
    
    # Get or create session
    session_id = request.session_id or str(uuid.uuid4())
    session_state = get_session(session_id)
    
    # Check cache (separate cache key for general model)
    cache_key = f"general_{get_cache_key(request.current_message.text, [m.dict() for m in request.context_messages])}"
    
    cached_suggestion = get_from_cache(cache_key)
    if cached_suggestion:
        print(f"[CACHE HIT] General model for session {session_id}")
        return GeneralReplyResponse(
            suggestion=cached_suggestion,
            session_id=session_id,
            model_used=GENERAL_MODEL,
            cached=True
        )
    
    print(f"[PROCESSING] General model with {len(request.context_messages)} context messages")
    
    try:
        # Build conversation history: context messages + current message
        conversation = []
        
        # Add context messages (oldest to newest)
        for msg in reversed(request.context_messages):
            role = "assistant" if msg.type == "outgoing" else "user"
            conversation.append({
                "role": role,
                "content": msg.text
            })
        
        # Add current message (the one we need to reply to)
        conversation.append({
            "role": "user",
            "content": request.current_message.text
        })
        
        # Add system prompt
        messages = [
            {
                "role": "system",
                "content": "You are a helpful assistant that suggests appropriate replies to messages. Provide a natural, contextual response."
            }
        ] + conversation
        
        # Call general LLM
        response = client.chat.completions.create(
            model=GENERAL_MODEL,
            messages=messages,
            max_tokens=CONFIG["MAX_TOKENS"],
            temperature=0.7,
            top_p=0.9,
        )
        
        reply_suggestion = response.choices[0].message.content.strip()
        
        # Cache the result
        background_tasks.add_task(set_cache, cache_key, reply_suggestion)
        
        # Update session
        state_data = {
            "current_message": request.current_message.dict(),
            "context_messages": [m.dict() for m in request.context_messages],
            "reply_suggestion": reply_suggestion
        }
        
        if session_state:
            session_state["state"] = state_data
        else:
            session_state = {"state": state_data}
        
        background_tasks.add_task(save_session, session_id, session_state)
        
        print(f"[SUCCESS] Generated reply using general model for session {session_id}")
        
        return GeneralReplyResponse(
            suggestion=reply_suggestion,
            session_id=session_id,
            model_used=GENERAL_MODEL,
            cached=False
        )
        
    except Exception as e:
        print(f"[ERROR] {str(e)}")
        
        # Handle rate limits
        if "rate limit" in str(e).lower():
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please try again in a moment."
            )
        
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate reply: {str(e)}"
        )


@app.delete("/session/{session_id}")
async def clear_session(session_id: str):
    """Clear session data"""
    if session_id in sessions:
        del sessions[session_id]
        return {"message": "Session cleared"}
    return {"message": "Session not found"}


@app.get("/session/{session_id}/info")
async def get_session_info(session_id: str):
    """Get session information"""
    session = get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return {
        "session_id": session_id,
        "last_activity": session["last_activity"],
        "state_keys": list(session["state"].keys())
    }


@app.get("/health")
async def health():
    """Health check"""
    cleanup_cache()
    
    return {
        "status": "healthy",
        "model": FINE_TUNED_MODEL,
        "active_sessions": len(sessions),
        "cached_replies": len(reply_cache)
    }


@app.get("/")
async def root():
    return {
        "message": "Reply Suggestion API with Context Window + General Chat",
        "model": FINE_TUNED_MODEL,
        "context_window": CONFIG["CONTEXT_WINDOW"],
        "endpoints": {
            "/suggest-reply": {
                "method": "POST",
                "description": "Get reply suggestions with fine-tuned model",
                "model": "Fine-tuned model",
                "features": ["Context-aware", "Caching", "Session management"]
            },
            "/suggest-reply-general": {
                "method": "POST",
                "description": "Get reply suggestions with general LLM (Llama 3.1)",
                "model": "General LLM",
                "features": ["Same format as suggest-reply", "Uses general model instead"]
            }
        },
        "features": [
            "Context-aware reply suggestions",
            "Fine-tuned model support",
            "General LLM support",
            "Response caching",
            "Session management"
        ]
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)