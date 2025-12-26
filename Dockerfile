# Use official Python runtime as a parent image
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system dependencies if needed (e.g. for lxml)
RUN apt-get update && apt-get install -y gcc libxml2-dev libxslt-dev && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Create directory for static/templates if they don't exist (safety)
RUN mkdir -p static templates

# Fix permissions for Hugging Face (it runs as user 1000)
RUN chmod -R 777 /app

# Expose the port Hugging Face expects (7860)
EXPOSE 7860

# Define start command
CMD ["uvicorn", "server_ultra:app", "--host", "0.0.0.0", "--port", "7860"]
