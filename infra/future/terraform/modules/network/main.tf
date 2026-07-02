# Split the VPC CIDR into 4 groups of subnets:
#   public   /20 x AZs — ALB, NAT
#   private  /20 x AZs — EKS workloads
#   db       /24 x AZs — Aurora, isolated
#   cache    /24 x AZs — ElastiCache, isolated
locals {
  public_cidrs  = [for i, az in var.azs : cidrsubnet(var.vpc_cidr, 4, i)]              # /20
  private_cidrs = [for i, az in var.azs : cidrsubnet(var.vpc_cidr, 4, i + 8)]          # /20
  db_cidrs      = [for i, az in var.azs : cidrsubnet(var.vpc_cidr, 8, i + 128)]        # /24
  cache_cidrs   = [for i, az in var.azs : cidrsubnet(var.vpc_cidr, 8, i + 136)]        # /24
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${var.cluster_name}-${var.environment}-vpc"
  }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags = {
    Name = "${var.cluster_name}-${var.environment}-igw"
  }
}

# ---- Subnets --------------------------------------------------------------

resource "aws_subnet" "public" {
  count                   = length(var.azs)
  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_cidrs[count.index]
  availability_zone       = var.azs[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name                                                = "${var.cluster_name}-${var.environment}-public-${count.index}"
    "kubernetes.io/role/elb"                            = "1"
    "kubernetes.io/cluster/${var.cluster_name}-${var.environment}" = "shared"
  }
}

resource "aws_subnet" "private" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_cidrs[count.index]
  availability_zone = var.azs[count.index]

  tags = {
    Name                                                = "${var.cluster_name}-${var.environment}-private-${count.index}"
    "kubernetes.io/role/internal-elb"                   = "1"
    "kubernetes.io/cluster/${var.cluster_name}-${var.environment}" = "shared"
  }
}

resource "aws_subnet" "db" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.db_cidrs[count.index]
  availability_zone = var.azs[count.index]

  tags = {
    Name = "${var.cluster_name}-${var.environment}-db-${count.index}"
  }
}

resource "aws_subnet" "cache" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.cache_cidrs[count.index]
  availability_zone = var.azs[count.index]

  tags = {
    Name = "${var.cluster_name}-${var.environment}-cache-${count.index}"
  }
}

# ---- NAT gateways (one per AZ for HA) -------------------------------------

resource "aws_eip" "nat" {
  count  = length(var.azs)
  domain = "vpc"
  tags = {
    Name = "${var.cluster_name}-${var.environment}-nat-eip-${count.index}"
  }
}

resource "aws_nat_gateway" "this" {
  count         = length(var.azs)
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  depends_on = [aws_internet_gateway.this]

  tags = {
    Name = "${var.cluster_name}-${var.environment}-nat-${count.index}"
  }
}

# ---- Route tables ---------------------------------------------------------

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = {
    Name = "${var.cluster_name}-${var.environment}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = length(var.azs)
  vpc_id = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[count.index].id
  }
  tags = {
    Name = "${var.cluster_name}-${var.environment}-private-rt-${count.index}"
  }
}

resource "aws_route_table_association" "private" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# DB and cache subnets are isolated — no outbound route by default.
# S3 gateway endpoint below covers RDS snapshot exports without needing NAT.

# ---- VPC endpoints (reduce NAT costs + strengthen egress control) ---------

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat(
    aws_route_table.private[*].id,
    [aws_route_table.public.id],
  )
  tags = {
    Name = "${var.cluster_name}-${var.environment}-s3-endpoint"
  }
}

resource "aws_vpc_endpoint" "ecr_api" {
  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.ecr.api"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
}

resource "aws_vpc_endpoint" "ecr_dkr" {
  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.ecr.dkr"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
}

resource "aws_security_group" "vpc_endpoints" {
  name        = "${var.cluster_name}-${var.environment}-vpce-sg"
  description = "Allow HTTPS from VPC to interface endpoints"
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.cluster_name}-${var.environment}-vpce-sg"
  }
}

data "aws_region" "current" {}
