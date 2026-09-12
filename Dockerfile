FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source code
COPY . .

# Set default environment variables
ENV PORT=8080
ENV NODE_ENV=production
ENV SKIP_AUTH_VALIDATION=false

# Expose port
EXPOSE 8080

# Start server
CMD ["npm", "start"]
