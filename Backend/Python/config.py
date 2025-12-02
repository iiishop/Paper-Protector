"""
Configuration management for the Bridge Server
"""
import os
from typing import Optional


class Config:
    """Configuration class for Bridge Server settings"""
    
    def __init__(self):
        # Serial port configuration
        self.serial_port: str = os.getenv("SERIAL_PORT", "COM3")
        self.baudrate: int = int(os.getenv("BAUDRATE", "9600"))
        self.serial_timeout: float = float(os.getenv("SERIAL_TIMEOUT", "1.0"))
        
        # WebSocket configuration
        self.ws_host: str = os.getenv("WS_HOST", "0.0.0.0")
        self.ws_port: int = int(os.getenv("WS_PORT", "8000"))
        
        # Reconnection settings
        self.reconnect_interval: int = int(os.getenv("RECONNECT_INTERVAL", "5"))
        
        # Limits
        self.max_ws_connections: int = int(os.getenv("MAX_WS_CONNECTIONS", "100"))
        
    def update_from_args(self, port: Optional[str] = None, baudrate: Optional[int] = None):
        """Update configuration from command line arguments"""
        if port:
            self.serial_port = port
        if baudrate:
            self.baudrate = baudrate


# Global configuration instance
config = Config()
