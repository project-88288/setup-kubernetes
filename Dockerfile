FROM node:20-alpine

WORKDIR /app

# Install kubectl for Kubernetes deployment
RUN apk add --no-cache curl bash && \
    curl -L https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl -o /usr/local/bin/kubectl && \
    chmod +x /usr/local/bin/kubectl

# Copy generator files
COPY package.json .
COPY generate.js .
COPY .env .
COPY config/ ./config/
COPY manifests/ ./manifests/

# Install dependencies (if any)
RUN npm ci --omit=dev || true

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["run"]
