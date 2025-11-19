from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from together import Together
import os
from typing import Optional, List, Dict
import uuid
from datetime import datetime
import hashlib

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
GENERAL_MODEL = os.getenv("GENERAL_MODEL", "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo")

# In-memory storage
sessions = {}
reply_cache = {}

CONFIG = {
    "CONTEXT_WINDOW": 4,
    "CACHE_TTL": 600,
    "SESSION_TTL": 3600,
    "MAX_TOKENS": 512,
}


# State definition - unified for both models
class ReplySuggestionState(TypedDict):
    current_message: Dict
    context_messages: List[Dict]
    conversation_history: List[Dict]
    reply_suggestion: str
    model_type: str  # "fine-tuned" or "general"
    model_name: str


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
    context_messages: List[ContextMessage]
    session_id: Optional[str] = None


class SuggestReplyResponse(BaseModel):
    suggestion: str
    session_id: str
    model_used: str
    cached: bool = False


# Cache helpers
def get_cache_key(current_msg: str, context: List[Dict], model_type: str) -> str:
    """Generate cache key from current message + context + model type"""
    context_str = "|".join([f"{m['type']}:{m['text']}" for m in context])
    content = f"{model_type}::{current_msg}::{context_str}"
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


# LangGraph Nodes - Unified for both models
def build_conversation_node(state: ReplySuggestionState) -> ReplySuggestionState:
    """Build the conversation history for the model"""
    context_messages = state["context_messages"]
    current_message = state["current_message"]
    
    conversation = []
    
    # Add context messages (oldest to newest)
    for msg in reversed(context_messages):
        role = "assistant" if msg["type"] == "outgoing" else "user"
        conversation.append({
            "role": role,
            "content": msg["text"]
        })
    
    # Add current message
    conversation.append({
        "role": "user",
        "content": current_message["text"]
    })
    
    return {
        **state,
        "conversation_history": conversation
    }


def generate_reply_node(state: ReplySuggestionState) -> ReplySuggestionState:
    """Generate reply suggestion - handles both fine-tuned and general models"""
    conversation_history = state["conversation_history"]
    model_type = state["model_type"]
    model_name = state["model_name"]
    
    try:
        # Different system prompts based on model type
        if model_type == "general":
            system_content = (
                "You help people reply to their messages. Look at the conversation history "
                "to understand the context and tone. Then suggest what the person should reply back. "
                "Keep it natural and casual like how people actually text. Match their vibe whether "
                "its chill, excited, formal, or whatever. Just give the reply text itself, nothing else. "
                "No quotation marks, no extra explanation, just the message they should send."
            )
        else:
            system_content = (
                "You are Manslater-Reply, an assistant that generates the perfect reply to someone's message based on the chat context.\n\n"
                "Your job:\n"
                "Given context messages (previous conversation) and the current message (what the other person just said), "
                "you must create a smooth, emotionally intelligent, flirty/cheeky/nonchalant response that fits the Manslater vibe:\n"
                "- slightly playful\n"
                "- confident\n"
                "- warm but not needy\n"
                "- subtly charming\n"
                "- never dry or robotic\n\n"
                "Rules:\n"
                "- Understand the tone from the context and maintain consistency\n"
                "- Never over-explain—keep it human and natural\n"
                "- Add emotion when needed (cute, warm, reassuring, teasing, or romantic)\n"
                "- If the message needs comfort → be gentle\n"
                "- If the message is dry → spice it up\n"
                "- If the message is flirty → match energy or increase slightly\n"
                "- If the message is confusing → reply in a cool, calm, manlike manner\n"
                "- If the message requires a question → ask one smoothly\n"
                "- Never lecture, never sound formal\n"
                "- Be VERY CHEEKY in your suggestions\n\n"
                "Output format: Only output the reply text. Nothing else. No quotation marks, no explanation."
            )
        
        messages = [
            {
                "role": "system",
                "content": system_content
            }
        ] + conversation_history
        
        # Call the appropriate model
        response = client.chat.completions.create(
            model=model_name,
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
    """Create the unified reply suggestion workflow"""
    workflow = StateGraph(ReplySuggestionState)
    
    workflow.add_node("build_conversation", build_conversation_node)
    workflow.add_node("generate_reply", generate_reply_node)
    
    workflow.set_entry_point("build_conversation")
    workflow.add_edge("build_conversation", "generate_reply")
    workflow.add_edge("generate_reply", END)
    
    return workflow.compile()


reply_graph = create_reply_graph()


async def process_reply_suggestion(
    request: SuggestReplyRequest,
    model_type: str,
    background_tasks: BackgroundTasks
) -> SuggestReplyResponse:
    """
    Unified processing function for both fine-tuned and general models
    """
    # Validate context window
    if len(request.context_messages) > CONFIG["CONTEXT_WINDOW"]:
        raise HTTPException(
            status_code=400,
            detail=f"Context messages exceed maximum of {CONFIG['CONTEXT_WINDOW']}"
        )
    
    # Determine model
    model_name = FINE_TUNED_MODEL if model_type == "fine-tuned" else GENERAL_MODEL
    
    # Get or create session
    session_id = request.session_id or str(uuid.uuid4())
    session_state = get_session(session_id)
    
    # Check cache
    cache_key = get_cache_key(
        request.current_message.text,
        [m.dict() for m in request.context_messages],
        model_type
    )
    
    cached_suggestion = get_from_cache(cache_key)
    if cached_suggestion:
        print(f"[CACHE HIT] {model_type} model for session {session_id}")
        return SuggestReplyResponse(
            suggestion=cached_suggestion,
            session_id=session_id,
            model_used=model_name,
            cached=True
        )
    
    print(f"[PROCESSING] {model_type} model with {len(request.context_messages)} context messages")
    
    try:
        # Prepare state for LangGraph
        initial_state: ReplySuggestionState = {
            "current_message": request.current_message.dict(),
            "context_messages": [m.dict() for m in request.context_messages],
            "conversation_history": [],
            "reply_suggestion": "",
            "model_type": model_type,
            "model_name": model_name
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
        
        print(f"[SUCCESS] Generated reply using {model_type} model for session {session_id}")
        
        return SuggestReplyResponse(
            suggestion=reply_suggestion,
            session_id=session_id,
            model_used=model_name,
            cached=False
        )
        
    except Exception as e:
        print(f"[ERROR] {str(e)}")
        
        if "rate limit" in str(e).lower():
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please try again in a moment."
            )
        
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate reply: {str(e)}"
        )


@app.post("/suggest-reply", response_model=SuggestReplyResponse)
async def suggest_reply(request: SuggestReplyRequest, background_tasks: BackgroundTasks):
    """
    Generate reply suggestion using fine-tuned model.
    Uses unified LangGraph workflow.
    """
    return await process_reply_suggestion(request, "fine-tuned", background_tasks)


@app.post("/suggest-reply-general", response_model=SuggestReplyResponse)
async def suggest_reply_general(request: SuggestReplyRequest, background_tasks: BackgroundTasks):
    """
    Generate reply suggestion using general LLM (Llama 3.1).
    Uses unified LangGraph workflow.
    """
    return await process_reply_suggestion(request, "general", background_tasks)


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
        "fine_tuned_model": FINE_TUNED_MODEL,
        "general_model": GENERAL_MODEL,
        "active_sessions": len(sessions),
        "cached_replies": len(reply_cache)
    }


@app.get("/")
async def root():
    return {
        "message": "Unified Reply Suggestion API with LangGraph",
        "models": {
            "fine_tuned": FINE_TUNED_MODEL,
            "general": GENERAL_MODEL
        },
        "context_window": CONFIG["CONTEXT_WINDOW"],
        "endpoints": {
            "/suggest-reply": {
                "method": "POST",
                "description": "Get reply suggestions with fine-tuned model",
                "model": "Fine-tuned model"
            },
            "/suggest-reply-general": {
                "method": "POST",
                "description": "Get reply suggestions with general LLM",
                "model": "General LLM (Llama 3.1)"
            }
        },
        "features": [
            "Unified LangGraph workflow",
            "Context-aware reply suggestions",
            "Response caching with model-specific keys",
            "Session management",
            "Both fine-tuned and general model support"
        ]
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)