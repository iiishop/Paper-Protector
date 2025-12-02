"""
WebSocket Manager Module
Manages WebSocket client connections and message broadcasting
"""
import asyncio
import logging
from typing import List, Dict, Any
from fastapi import WebSocket
import json

logger = logging.getLogger(__name__)


class WebSocketManager:
    """Manages WebSocket client connections"""
    
    def __init__(self, max_connections: int = 100):
        """
        Initialize WebSocketManager
        
        Args:
            max_connections: Maximum number of concurrent connections
        """
        self.active_connections: List[WebSocket] = []
        self.max_connections = max_connections
        
    async def connect(self, websocket: WebSocket) -> bool:
        """
        Accept and register a new WebSocket connection
        
        Args:
            websocket: WebSocket connection to register
            
        Returns:
            True if connection accepted, False if limit reached
        """
        if len(self.active_connections) >= self.max_connections:
            logger.warning(f"Connection limit reached ({self.max_connections})")
            return False
        
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"Client connected. Total connections: {len(self.active_connections)}")
        return True
    
    async def disconnect(self, websocket: WebSocket):
        """
        Remove a WebSocket connection
        
        Args:
            websocket: WebSocket connection to remove
        """
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"Client disconnected. Total connections: {len(self.active_connections)}")
    
    async def broadcast(self, message: Dict[str, Any]):
        """
        Broadcast a message to all connected clients
        
        Args:
            message: Dictionary to send as JSON
        """
        if not self.active_connections:
            return
        
        # Convert message to JSON string
        try:
            message_json = json.dumps(message)
        except Exception as e:
            logger.error(f"Error serializing message: {e}")
            return
        
        # Send to all clients, removing disconnected ones
        disconnected = []
        
        for connection in self.active_connections:
            try:
                await connection.send_text(message_json)
            except Exception as e:
                logger.error(f"Error sending to client: {e}")
                disconnected.append(connection)
        
        # Clean up disconnected clients
        for connection in disconnected:
            await self.disconnect(connection)
    
    async def send_personal(self, message: Dict[str, Any], websocket: WebSocket):
        """
        Send a message to a specific client
        
        Args:
            message: Dictionary to send as JSON
            websocket: Target WebSocket connection
        """
        try:
            message_json = json.dumps(message)
            await websocket.send_text(message_json)
        except Exception as e:
            logger.error(f"Error sending personal message: {e}")
            # Remove if connection is broken
            await self.disconnect(websocket)
    
    def get_connection_count(self) -> int:
        """
        Get the number of active connections
        
        Returns:
            Number of active connections
        """
        return len(self.active_connections)
    
    async def broadcast_status(self, status: str, details: Dict[str, Any] = None):
        """
        Broadcast a status message to all clients
        
        Args:
            status: Status string (e.g., 'connected', 'disconnected')
            details: Optional additional details
        """
        message = {
            'type': 'status',
            'status': status,
            'details': details or {}
        }
        await self.broadcast(message)
