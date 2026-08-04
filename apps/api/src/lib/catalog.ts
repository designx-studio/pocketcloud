// Feature 5: Prebuilt Service Catalog
// Static reference catalog of curated service blueprints

export interface ServiceDefinition {
    slug: string;
    name: string;
    description: string;
    category: "database" | "cache" | "queue" | "storage" | "monitoring" | "devtool" | "proxy";
    provider: string[];
    ports: number[];
    envVars: string[];
    volumes: string[];
    dependencies: string[];
}

export const SERVICE_CATALOG: ServiceDefinition[] = [
    {
        slug: "postgresql-16",
        name: "PostgreSQL 16",
        description: "Production-ready PostgreSQL 16 with performance tuning",
        category: "database",
        provider: ["oracle", "aws", "gcp", "hetzner", "digitalocean", "vultr"],
        ports: [5432],
        envVars: ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"],
        volumes: ["/var/lib/postgresql/data"],
        dependencies: [],
    },
    {
        slug: "redis-7",
        name: "Redis 7",
        description: "High-performance in-memory cache and message broker",
        category: "cache",
        provider: ["oracle", "aws", "gcp", "hetzner", "digitalocean", "vultr"],
        ports: [6379],
        envVars: ["REDIS_PASSWORD"],
        volumes: ["/data"],
        dependencies: [],
    },
    {
        slug: "rabbitmq",
        name: "RabbitMQ",
        description: "Reliable message queue with management UI",
        category: "queue",
        provider: ["oracle", "aws", "gcp", "hetzner", "digitalocean", "vultr"],
        ports: [5672, 15672],
        envVars: ["RABBITMQ_DEFAULT_USER", "RABBITMQ_DEFAULT_PASS"],
        volumes: ["/var/lib/rabbitmq"],
        dependencies: [],
    },
    {
        slug: "nginx",
        name: "Nginx",
        description: "High-performance web server and reverse proxy",
        category: "proxy",
        provider: ["oracle", "aws", "gcp", "hetzner", "digitalocean", "vultr"],
        ports: [80, 443],
        envVars: [],
        volumes: ["/etc/nginx/conf.d", "/var/log/nginx"],
        dependencies: [],
    },
    {
        slug: "minio",
        name: "MinIO",
        description: "S3-compatible object storage server",
        category: "storage",
        provider: ["oracle", "aws", "gcp", "hetzner", "digitalocean", "vultr"],
        ports: [9000, 9001],
        envVars: ["MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD"],
        volumes: ["/data"],
        dependencies: [],
    },
    {
        slug: "prometheus",
        name: "Prometheus",
        description: "Time-series metrics collection and alerting",
        category: "monitoring",
        provider: ["oracle", "aws", "gcp", "hetzner", "digitalocean", "vultr"],
        ports: [9090],
        envVars: [],
        volumes: ["/prometheus"],
        dependencies: [],
    },
    {
        slug: "grafana",
        name: "Grafana",
        description: "Metrics visualization and dashboards",
        category: "monitoring",
        provider: ["oracle", "aws", "gcp", "hetzner", "digitalocean", "vultr"],
        ports: [3000],
        envVars: ["GF_SECURITY_ADMIN_PASSWORD"],
        volumes: ["/var/lib/grafana"],
        dependencies: ["prometheus"],
    },
];

export function getService(slug: string): ServiceDefinition | undefined {
    return SERVICE_CATALOG.find((s) => s.slug === slug);
}

export function listServices(category?: string): ServiceDefinition[] {
    if (!category) return SERVICE_CATALOG;
    return SERVICE_CATALOG.filter((s) => s.category === category);
}