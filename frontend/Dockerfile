# ---------- Stage 1: Build React app ----------
FROM node:18-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy source code (including .env)
COPY . .

# 🔥 IMPORTANT: Inject env at BUILD time
ARG REACT_APP_API_BASE_URL
ENV REACT_APP_API_BASE_URL=$REACT_APP_API_BASE_URL

# Build React
RUN npm run build

# ---------- Stage 2: Serve with Nginx ----------
FROM nginx:1.25.3-alpine

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
