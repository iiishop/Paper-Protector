@echo off
REM Windows batch script to run the Bridge Server
REM Usage: run_bridge.bat [--port COM3] [--baudrate 9600]

python run_bridge.py %*
