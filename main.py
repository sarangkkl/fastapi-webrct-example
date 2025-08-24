from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import json
from typing import Dict, Set
import uuid

app = FastAPI()

# Store active connections
connections: Dict[str, WebSocket] = {}
rooms: Dict[str, Set[str]] = {}

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def get():
    with open("static/index.html") as f:
        return HTMLResponse(content=f.read(), status_code=200)

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    await websocket.accept()
    connections[user_id] = websocket
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message["type"] == "join_room":
                room_id = message["room_id"]
                if room_id not in rooms:
                    rooms[room_id] = set()
                rooms[room_id].add(user_id)
                
                # Notify other users in the room
                for other_user_id in rooms[room_id]:
                    if other_user_id != user_id and other_user_id in connections:
                        await connections[other_user_id].send_text(json.dumps({
                            "type": "user_joined",
                            "user_id": user_id
                        }))
            
            elif message["type"] in ["offer", "answer", "ice_candidate", "call_request", "call_accepted", "call_declined"]:
                target_user_id = message["target_user_id"]
                if target_user_id in connections:
                    message["from_user_id"] = user_id
                    await connections[target_user_id].send_text(json.dumps(message))
    
    except WebSocketDisconnect:
        # Remove user from connections and rooms
        if user_id in connections:
            del connections[user_id]
        
        for room_id, users in rooms.items():
            if user_id in users:
                users.remove(user_id)
                # Notify other users
                for other_user_id in users:
                    if other_user_id in connections:
                        await connections[other_user_id].send_text(json.dumps({
                            "type": "user_left",
                            "user_id": user_id
                        }))

