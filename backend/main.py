from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from together import Together
import os
from typing import Optional, List, Dict, Annotated
import uuid
from datetime import datetime, timedelta

# LangGraph imports
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

app = FastAPI()

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Together AI client
client = Together(api_key=os.getenv("TOGETHER_API_KEY"))

# Your fine-tuned model ID
FINE_TUNED_MODEL = os.getenv("FINE_TUNED_MODEL_ID", "your-fine-tuned-model-id")

# Session storage
sessions = {}


# Define the state structure for LangGraph
class TranslationState(TypedDict):
    messages: Annotated[List[Dict], add_messages]
    user_input: str
    translation: str
    context_summary: str
    translation_count: int


def cleanup_old_sessions():
    """Remove sessions older than 1 hour"""
    cutoff_time = datetime.now() - timedelta(hours=1)
    sessions_to_remove = [
        sid for sid, data in sessions.items()
        if data.get("last_activity", datetime.now()) < cutoff_time
    ]
    for sid in sessions_to_remove:
        del sessions[sid]


# LangGraph Node: Process user input and prepare context
def process_input_node(state: TranslationState) -> TranslationState:
    """Process the user input and extract relevant context"""
    user_input = state["user_input"]
    messages = state.get("messages", [])
    
    # Add user message to conversation
    messages.append({
        "role": "user",
        "content": user_input
    })
    
    return {
        **state,
        "messages": messages,
        "translation_count": state.get("translation_count", 0) + 1
    }


# LangGraph Node: Generate context summary from conversation history
def generate_context_node(state: TranslationState) -> TranslationState:
    """Generate a context summary from previous conversation"""
    messages = state.get("messages", [])
    
    # Only generate summary if there are previous messages (beyond current)
    if len(messages) > 2:  # More than just the current user message
        try:
            # Create a summary of previous context
            context_messages = [
                {
                    "role": "system",
                    "content": "Summarize the key context from this conversation in 1-2 sentences."
                }
            ] + messages[:-1]  # Exclude the latest message
            
            context_response = client.chat.completions.create(
                model=FINE_TUNED_MODEL,
                messages=context_messages,
                max_tokens=150,
                temperature=0.3,
            )
            
            context_summary = context_response.choices[0].message.content
        except Exception as e:
            print(f"Context generation error: {e}")
            context_summary = state.get("context_summary", "")
    else:
        context_summary = ""
    
    return {
        **state,
        "context_summary": context_summary
    }


# LangGraph Node: Perform translation with context
def translate_node(state: TranslationState) -> TranslationState:
    """Perform translation using the fine-tuned model with full context"""
    messages = state["messages"]
    context_summary = state.get("context_summary", "")
    
    # Prepare messages with context
    translation_messages = []
    
    # Add context summary if available
    if context_summary:
        translation_messages.append({
            "role": "system",
            "content": f"Previous conversation context: {context_summary}"
        })
    
    # Add all conversation history
    translation_messages.extend(messages)
    
    try:
        # Call fine-tuned model
        response = client.chat.completions.create(
            model=FINE_TUNED_MODEL,
            messages=translation_messages,
            max_tokens=1024,
            temperature=0.7,
            top_p=0.9,
        )
        
        translation = response.choices[0].message.content
        
        # Add assistant response to messages
        messages.append({
            "role": "assistant",
            "content": translation
        })
        
    except Exception as e:
        raise Exception(f"Translation failed: {str(e)}")
    
    return {
        **state,
        "translation": translation,
        "messages": messages
    }


# Build the LangGraph workflow
def create_translation_graph():
    """Create the LangGraph workflow for translation with context"""
    workflow = StateGraph(TranslationState)
    
    # Add nodes
    workflow.add_node("process_input", process_input_node)
    workflow.add_node("generate_context", generate_context_node)
    workflow.add_node("translate", translate_node)
    
    # Define the flow
    workflow.set_entry_point("process_input")
    workflow.add_edge("process_input", "generate_context")
    workflow.add_edge("generate_context", "translate")
    workflow.add_edge("translate", END)
    
    return workflow.compile()


# Initialize the graph
translation_graph = create_translation_graph()


class TranslateRequest(BaseModel):
    text: str
    session_id: Optional[str] = None


class TranslateResponse(BaseModel):
    translation: str
    session_id: str
    context_summary: Optional[str] = None
    translation_count: int


@app.post("/translate", response_model=TranslateResponse)
async def translate(request: TranslateRequest):
    """
    Translate input text using LangGraph workflow with context management.
    """
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    cleanup_old_sessions()

    # Get or create session
    session_id = request.session_id or str(uuid.uuid4())
    
    if session_id not in sessions:
        sessions[session_id] = {
            "state": {
                "messages": [],
                "user_input": "",
                "translation": "",
                "context_summary": "",
                "translation_count": 0
            },
            "last_activity": datetime.now()
        }
    
    session = sessions[session_id]
    session["last_activity"] = datetime.now()

    try:
        # Get current state
        current_state = session["state"]
        
        # Update with new user input
        current_state["user_input"] = request.text
        
        # Run through LangGraph workflow
        result = translation_graph.invoke(current_state)
        
        # Update session state
        session["state"] = result
        
        return TranslateResponse(
            translation=result["translation"],
            session_id=session_id,
            context_summary=result.get("context_summary"),
            translation_count=result.get("translation_count", 1)
        )

    except Exception as e:
        error_message = str(e)
        
        if "rate limit" in error_message.lower():
            raise HTTPException(
                status_code=429,
                detail={
                    "message": "Whoa there! Too many requests.\nTake a breather and try again in a minute."
                }
            )
        
        raise HTTPException(
            status_code=500,
            detail=f"Translation failed: {error_message}"
        )


@app.delete("/session/{session_id}")
async def clear_session(session_id: str):
    """Clear session history"""
    if session_id in sessions:
        del sessions[session_id]
        return {"message": "Session cleared successfully"}
    return {"message": "Session not found"}


@app.get("/session/{session_id}/context")
async def get_session_context(session_id: str):
    """Get current session context and history"""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = sessions[session_id]
    state = session["state"]
    
    return {
        "session_id": session_id,
        "translation_count": state.get("translation_count", 0),
        "context_summary": state.get("context_summary", ""),
        "message_count": len(state.get("messages", []))
    }


@app.get("/")
async def root():
    return {
        "message": "Translation API with LangGraph Context Management",
        "model": FINE_TUNED_MODEL,
        "active_sessions": len(sessions),
        "features": [
            "Context-aware translations",
            "Conversation history tracking",
            "Automatic context summarization"
        ]
    }


@app.get("/health")
async def health():
    cleanup_old_sessions()
    return {
        "status": "healthy",
        "active_sessions": len(sessions),
        "model": FINE_TUNED_MODEL
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)