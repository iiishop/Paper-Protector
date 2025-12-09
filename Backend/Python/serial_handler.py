"""
Serial Handler Module
Manages serial port communication with Arduino
"""
import asyncio
import logging
from typing import Optional, Dict
import serial
import serial_asyncio

logger = logging.getLogger(__name__)


class SerialHandler:
    """Handles serial port communication with Arduino"""
    
    def __init__(self, port: str, baudrate: int = 9600, timeout: float = 1.0, reconnect_interval: int = 5):
        """
        Initialize SerialHandler
        
        Args:
            port: Serial port name (e.g., 'COM3' or '/dev/ttyUSB0')
            baudrate: Communication speed (default: 9600)
            timeout: Read timeout in seconds
            reconnect_interval: Seconds between reconnection attempts
        """
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.reconnect_interval = reconnect_interval
        self.serial_connection = None
        self.reader = None
        self.writer = None
        self.is_connected = False
        self._reconnect_task = None
        self._should_reconnect = True
        self._status_callbacks = []
        
    async def connect(self) -> bool:
        """
        Connect to the serial port
        
        Returns:
            True if connection successful, False otherwise
        """
        try:
            logger.info(f"Attempting to connect to {self.port} at {self.baudrate} baud...")
            
            # Create serial connection using pyserial-asyncio
            self.reader, self.writer = await serial_asyncio.open_serial_connection(
                url=self.port,
                baudrate=self.baudrate,
                timeout=self.timeout
            )
            
            self.is_connected = True
            logger.info(f"Successfully connected to {self.port}")
            return True
            
        except serial.SerialException as e:
            logger.error(f"Failed to connect to {self.port}: {e}")
            self.is_connected = False
            return False
        except Exception as e:
            logger.error(f"Unexpected error connecting to {self.port}: {e}")
            self.is_connected = False
            return False
    
    async def disconnect(self):
        """Disconnect from the serial port"""
        if self.writer:
            try:
                self.writer.close()
                await self.writer.wait_closed()
                logger.info(f"Disconnected from {self.port}")
            except Exception as e:
                logger.error(f"Error during disconnect: {e}")
        
        self.is_connected = False
        self.reader = None
        self.writer = None
    
    async def read_message(self) -> Optional[Dict[str, str]]:
        """
        Read a message from the serial port
        
        Returns:
            Dictionary with 'topic' and 'payload' keys, or None if error/no data
        """
        if not self.is_connected or not self.reader:
            return None
        
        try:
            # Read until newline (message boundary)
            line = await self.reader.readuntil(b'\n')
            
            # Decode with error handling for invalid UTF-8
            try:
                message_str = line.decode('utf-8').strip()
            except UnicodeDecodeError as e:
                # Try with 'replace' to handle invalid bytes
                message_str = line.decode('utf-8', errors='replace').strip()
                logger.warning(f"Invalid UTF-8 in serial data (replaced): {line.hex()} -> {message_str}")
            
            if not message_str:
                return None
            
            # Parse the message
            parsed = self.parse_serial_message(message_str)
            if parsed:
                logger.debug(f"Received: {parsed}")
            return parsed
            
        except asyncio.IncompleteReadError:
            logger.warning("Incomplete read from serial port")
            return None
        except serial.SerialException as e:
            logger.error(f"Serial error while reading: {e}")
            self.is_connected = False
            return None
        except Exception as e:
            logger.error(f"Error reading message: {e}")
            return None
    
    async def write_message(self, topic: str, payload: str) -> bool:
        """
        Write a message to the serial port
        
        Args:
            topic: Message topic
            payload: Message payload
            
        Returns:
            True if write successful, False otherwise
        """
        if not self.is_connected or not self.writer:
            logger.warning("Cannot write: not connected")
            return False
        
        try:
            # Format the message
            message = self.format_serial_message(topic, payload)
            
            # Write to serial port
            self.writer.write(message.encode('utf-8'))
            await self.writer.drain()
            
            logger.debug(f"Sent: {topic}:{payload}")
            return True
            
        except serial.SerialException as e:
            logger.error(f"Serial error while writing: {e}")
            self.is_connected = False
            return False
        except Exception as e:
            logger.error(f"Error writing message: {e}")
            return False
    
    @staticmethod
    def parse_serial_message(message: str) -> Optional[Dict[str, str]]:
        """
        Parse a serial message from Arduino format to Python dict
        
        Format: TOPIC:PAYLOAD
        
        Args:
            message: Raw message string
            
        Returns:
            Dictionary with 'topic' and 'payload', or None if invalid
        """
        if not message:
            return None
        
        # Find the first colon separator
        colon_index = message.find(':')
        
        if colon_index == -1:
            logger.warning(f"Invalid message format (no colon): {message}")
            return None
        
        topic = message[:colon_index].strip()
        payload = message[colon_index + 1:].strip()
        
        # Validate topic is not empty
        if not topic:
            logger.warning(f"Invalid message format (empty topic): {message}")
            return None
        
        return {
            'topic': topic,
            'payload': payload
        }
    
    @staticmethod
    def format_serial_message(topic: str, payload: str) -> str:
        """
        Format a message from Python dict to Arduino serial format
        
        Format: TOPIC:PAYLOAD\n
        
        Args:
            topic: Message topic
            payload: Message payload
            
        Returns:
            Formatted message string with newline
        """
        return f"{topic}:{payload}\n"
    
    def add_status_callback(self, callback):
        """
        Add a callback to be notified of connection status changes
        
        Args:
            callback: Async function to call with status (True/False)
        """
        self._status_callbacks.append(callback)
    
    async def _notify_status_change(self, connected: bool):
        """Notify all callbacks of status change"""
        for callback in self._status_callbacks:
            try:
                await callback(connected)
            except Exception as e:
                logger.error(f"Error in status callback: {e}")
    
    async def start_reconnect_loop(self):
        """
        Start the automatic reconnection loop
        Runs in background and attempts to reconnect every reconnect_interval seconds
        """
        self._should_reconnect = True
        self._reconnect_task = asyncio.create_task(self._reconnect_loop())
        logger.info("Reconnection loop started")
    
    async def stop_reconnect_loop(self):
        """Stop the automatic reconnection loop"""
        self._should_reconnect = False
        if self._reconnect_task:
            self._reconnect_task.cancel()
            try:
                await self._reconnect_task
            except asyncio.CancelledError:
                pass
        logger.info("Reconnection loop stopped")
    
    async def _reconnect_loop(self):
        """Background task that continuously attempts to reconnect"""
        while self._should_reconnect:
            if not self.is_connected:
                logger.info(f"Attempting to reconnect to {self.port}...")
                success = await self.connect()
                
                if success:
                    await self._notify_status_change(True)
                else:
                    logger.warning(f"Reconnection failed, will retry in {self.reconnect_interval} seconds")
            
            # Wait before next attempt
            await asyncio.sleep(self.reconnect_interval)
    
    async def handle_disconnect(self):
        """Handle unexpected disconnection"""
        if self.is_connected:
            logger.warning(f"Connection to {self.port} lost")
            self.is_connected = False
            await self._notify_status_change(False)
            await self.disconnect()
