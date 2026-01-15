FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

COPY global-bundle.pem /app/global-bundle.pem

# Install only production dependencies first
RUN npm ci --only=production && npm cache clean --force

# Copy the full application (after deps installed to leverage cache)
COPY . .

FROM node:18-alpine

# Create non-root user for security
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs

# Set working directory
WORKDIR /app

# Copy only production files from builder
COPY --from=builder /app /app

# Switch to non-root user
USER nodejs

# Expose your app port
EXPOSE 3500

# Use NODE_ENV for better runtime optimization
ENV NODE_ENV=production

# Start the Node app
CMD ["node", "server.js"]

