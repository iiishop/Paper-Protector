"""
Bridge Server - FastAPI application entry point
Connects Arduino serial communication with WebSocket clients
"""
import asyncio
import logging
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import argparse

from config import config
from websocket_manager import WebSocketManager
from serial_handler import SerialHandler

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global instances
ws_manager = WebSocketManager(max_connections=config.max_ws_connections)
serial_handler = SerialHandler(
    port=config.serial_port,
    baudrate=config.baudrate,
    timeout=config.serial_timeout,
    reconnect_interval=config.reconnect_interval
)


async def serial_to_websocket_task():
    """
    Background task: continuously read from serial and broadcast to WebSocket clients
    """
    logger.info("Starting serial-to-websocket routing task")
    
    while True:
        try:
            if serial_handler.is_connected:
                # Read message from serial port
                message = await serial_handler.read_message()
                
                if message:
                    logger.debug(f"Routing message from Arduino: {message['topic']}")
                    
                    # Broadcast to all WebSocket clients
                    await ws_manager.broadcast({
                        'type': 'message',
                        'topic': message['topic'],
                        'payload': message['payload'],
                        'source': 'arduino'
                    })
                else:
                    # No message available, small delay
                    await asyncio.sleep(0.01)
            else:
                # Wait a bit if not connected
                await asyncio.sleep(0.5)
        
        except asyncio.CancelledError:
            logger.info("Serial-to-websocket task cancelled")
            break
        except Exception as e:
            logger.error(f"Error in serial-to-websocket task: {e}", exc_info=True)
            
            # Handle disconnection
            if serial_handler.is_connected:
                await serial_handler.handle_disconnect()
            
            await asyncio.sleep(1)


async def serial_status_callback(connected: bool):
    """
    Callback for serial connection status changes
    Notifies all WebSocket clients of status changes
    """
    status = 'connected' if connected else 'disconnected'
    logger.info(f"Serial status changed: {status}")
    
    await ws_manager.broadcast_status(status, {
        'serial_port': config.serial_port,
        'baudrate': config.baudrate
    })


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events
    Replaces the deprecated @app.on_event decorators
    """
    # Startup
    logger.info("Bridge Server starting...")
    logger.info(f"Serial port: {config.serial_port}")
    logger.info(f"Baudrate: {config.baudrate}")
    logger.info(f"WebSocket: {config.ws_host}:{config.ws_port}")
    
    # Register status callback
    serial_handler.add_status_callback(serial_status_callback)
    
    # Start serial reconnection loop
    await serial_handler.start_reconnect_loop()
    
    # Start serial-to-websocket routing task
    asyncio.create_task(serial_to_websocket_task())
    
    logger.info("Bridge Server started successfully")
    
    yield  # Server is running
    
    # Shutdown
    logger.info("Bridge Server shutting down...")
    
    # Stop reconnection loop
    await serial_handler.stop_reconnect_loop()
    
    # Disconnect serial
    await serial_handler.disconnect()
    
    logger.info("Bridge Server shutdown complete")


# Create FastAPI application with lifespan
app = FastAPI(
    title="Arduino Bridge Server",
    description="Bridge between Arduino serial communication and WebSocket clients",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PublishRequest(BaseModel):
    """Request model for publishing messages"""
    topic: str
    payload: str


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Arduino Bridge Server",
        "version": "1.0.0",
        "status": "running"
    }


@app.get("/api/status")
async def get_status():
    """
    Get the current status of the bridge server
    
    Returns:
        Status information including serial connection state
    """
    return {
        "serial": {
            "connected": serial_handler.is_connected,
            "port": config.serial_port,
            "baudrate": config.baudrate
        },
        "websocket": {
            "active_connections": ws_manager.get_connection_count(),
            "max_connections": config.max_ws_connections
        },
        "server": {
            "status": "running",
            "version": "1.0.0"
        }
    }


@app.post("/api/publish")
async def publish_message(request: PublishRequest):
    """
    Publish a message to Arduino via serial port
    
    Args:
        request: PublishRequest with topic and payload
        
    Returns:
        Success status and message details
        
    Raises:
        HTTPException: If serial port is not connected or write fails
    """
    if not serial_handler.is_connected:
        raise HTTPException(
            status_code=503,
            detail="Serial port not connected"
        )
    
    # Validate input
    if not request.topic:
        raise HTTPException(
            status_code=400,
            detail="Topic cannot be empty"
        )
    
    # Send message to serial port
    success = await serial_handler.write_message(request.topic, request.payload)
    
    if not success:
        raise HTTPException(
            status_code=500,
            detail="Failed to write to serial port"
        )
    
    return {
        "success": True,
        "topic": request.topic,
        "payload": request.payload,
        "message": "Message published successfully"
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for client connections
    Handles bidirectional communication between web clients and Arduino
    """
    client_id = id(websocket)
    logger.info(f"New WebSocket connection attempt from client {client_id}")
    
    # Accept the connection
    if not await ws_manager.connect(websocket):
        logger.warning(f"Connection rejected for client {client_id}: limit reached")
        await websocket.close(code=1008, reason="Connection limit reached")
        return
    
    try:
        # Send initial connection status
        await ws_manager.send_personal({
            'type': 'status',
            'status': 'connected' if serial_handler.is_connected else 'disconnected',
            'details': {
                'serial_port': config.serial_port,
                'baudrate': config.baudrate
            }
        }, websocket)
        
        logger.info(f"Client {client_id} connected successfully")
        
        # Handle incoming messages from this client
        while True:
            # Receive message from WebSocket client
            data = await websocket.receive_text()
            
            try:
                message = json.loads(data)
                message_type = message.get('type', 'publish')
                
                if message_type == 'publish':
                    # Forward publish message to Arduino via serial
                    topic = message.get('topic', '')
                    payload = message.get('payload', '')
                    
                    if topic:
                        logger.debug(f"Client {client_id} publishing: {topic}:{payload}")
                        success = await serial_handler.write_message(topic, payload)
                        
                        if not success:
                            logger.warning(f"Failed to write message from client {client_id}")
                        
                        # Send acknowledgment back to sender
                        await ws_manager.send_personal({
                            'type': 'ack',
                            'success': success,
                            'topic': topic
                        }, websocket)
                    else:
                        logger.warning(f"Client {client_id} sent message without topic")
                        await ws_manager.send_personal({
                            'type': 'error',
                            'message': 'Topic is required'
                        }, websocket)
                
                elif message_type == 'ping':
                    # Respond to ping with pong
                    await ws_manager.send_personal({
                        'type': 'pong'
                    }, websocket)
                
                else:
                    logger.warning(f"Unknown message type from client {client_id}: {message_type}")
                
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON from client {client_id}: {data[:100]}")
                await ws_manager.send_personal({
                    'type': 'error',
                    'message': 'Invalid JSON format'
                }, websocket)
            except Exception as e:
                logger.error(f"Error processing message from client {client_id}: {e}", exc_info=True)
                await ws_manager.send_personal({
                    'type': 'error',
                    'message': 'Internal server error'
                }, websocket)
    
    except WebSocketDisconnect:
        logger.info(f"Client {client_id} disconnected normally")
    except Exception as e:
        logger.error(f"WebSocket error for client {client_id}: {e}", exc_info=True)
    finally:
        await ws_manager.disconnect(websocket)
        logger.info(f"Client {client_id} cleanup complete")


def main():
    """Main entry point with argument parsing"""
    parser = argparse.ArgumentParser(description="Arduino Bridge Server")
    parser.add_argument("--port", type=str, help="Serial port (e.g., COM3 or /dev/ttyUSB0)")
    parser.add_argument("--baudrate", type=int, help="Serial baudrate (default: 9600)")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="WebSocket host")
    parser.add_argument("--ws-port", type=int, default=8000, help="WebSocket port")
    
    args = parser.parse_args()
    
    # Update configuration from arguments
    config.update_from_args(port=args.port, baudrate=args.baudrate)
    if args.host:
        config.ws_host = args.host
    if args.ws_port:
        config.ws_port = args.ws_port
    
    # Run the server
    import uvicorn
    uvicorn.run(app, host=config.ws_host, port=config.ws_port)


if __name__ == "__main__":
    main()
