# Auth Provider PRD (Product Requirements Document)
## A Modern, Full-Featured Authentication Platform

**Version:** 1.0  
**Date:** February 23, 2026  
**Status:** Draft  
**Target:** Enterprise-grade auth provider competing with Clerk, Auth0, Okta

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Core Authentication Features](#3-core-authentication-features)
4. [Session Management](#4-session-management)
5. [Organizations & Multi-tenancy](#5-organizations--multi-tenancy)
6. [Enterprise SSO](#6-enterprise-sso)
7. [Passkeys & WebAuthn](#7-passkeys--webauthn)
8. [Social Login & OAuth](#8-social-login--oauth)
9. [Security Features](#9-security-features)
10. [Admin Dashboard](#10-admin-dashboard)
11. [SDKs & APIs](#11-sdks--apis)
12. [Database Schema](#12-database-schema)
13. [Implementation Roadmap](#13-implementation-roadmap)
14. [TODO Checklist](#14-todo-checklist)

---

## 1. Executive Summary

### 1.1 Vision
Build a modern, developer-first authentication platform that rivals Clerk in developer experience while competing with Auth0/Okta on enterprise features. The platform must be:

- **Developer-friendly:** Excellent DX with pre-built UI components
- **Enterprise-ready:** SAML, SCIM, audit logs, compliance
- **Future-proof:** Passkeys, modern security standards
- **Cost-effective:** Transparent pricing without "enterprise tax"

### 1.2 Competitive Analysis

| Feature | Clerk | Auth0 | Okta | Our Target |
|---------|-------|-------|------|------------|
| Free MAUs | 10,000 | 7,500 | 0 | 10,000 |
| Social Login | ✅ | ✅ | ⚠️ | ✅ |
| SAML SSO | $99/mo | $1,500/mo | $2+/user | $50/mo |
| SCIM | ✅ | Enterprise | Enterprise | ✅ |
| Passkeys | ✅ | ✅ | ✅ | ✅ |
| Organizations | ✅ | Enterprise | Enterprise | ✅ |
| UI Components | ✅ | ❌ | ❌ | ✅ |
| Audit Logs | Pro | Enterprise | Enterprise | ✅ |

### 1.3 Key Differentiators

1. **Transparent Pricing:** No cliff between startup and enterprise
2. **B2B-First:** Organizations and enterprise features in all tiers
3. **Modern Stack:** Native passkey support, not bolted-on
4. **Self-Host Option:** For security-conscious enterprises

---

## 2. Architecture Overview

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Web SDK     │  │  Mobile SDK  │  │  Backend SDK     │  │
│  │  (React,Vue) │  │  (iOS,And)   │  │  (Node,Py,Go)    │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Frontend API (FAPI)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Auth Flows  │  │  Session Mgmt│  │  Token Service   │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Backend API (BAPI)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  User Mgmt   │  │  Org Mgmt    │  │  Webhook Service │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data Layer                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  PostgreSQL  │  │  Redis       │  │  S3/Storage      │  │
│  │  (Users,Orgs)│  │  (Sessions)  │  │  (Audit Logs)    │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

| Component | Technology | Reason |
|-----------|-----------|--------|
| API Gateway | Kong/AWS API Gateway | Rate limiting, auth, routing |
| Auth Service | Node.js/TypeScript | Fast iteration, ecosystem |
| Database | PostgreSQL 15+ | ACID, JSONB, Row Level Security |
| Cache | Redis Cluster | Sessions, rate limits |
| Message Queue | RabbitMQ/Amazon SQS | Webhooks, async tasks |
| Storage | S3-compatible | Audit logs, exports |
| Search | Elasticsearch | User/org search |

### 2.3 Multi-Region Deployment

```
┌────────────────────────────────────────────────────────────┐
│                     Global Load Balancer                    │
│                  (Geo-based routing)                        │
└──────────────────┬─────────────────────────────────────────┘
                   │
        ┌──────────┴──────────┬──────────────┐
        ▼                     ▼              ▼
┌──────────────┐      ┌──────────────┐  ┌──────────────┐
│   us-east    │◄────►│   eu-west    │  │   ap-south   │
│  (Primary)   │      │  (Replica)   │  │  (Replica)   │
└──────────────┘      └──────────────┘  └──────────────┘
```

---

## 3. Core Authentication Features

### 3.1 Authentication Methods

#### 3.1.1 Password Authentication
- [ ] **Secure Password Hashing:** Argon2id (winner of Password Hashing Competition)
  - Memory: 64MB
  - Iterations: 3
  - Parallelism: 4
- [ ] **Password Policy:**
  - Minimum 8 characters
  - Complexity requirements (configurable)
  - Breach detection via HaveIBeenPwned API
- [ ] **Rate Limiting:** 5 attempts per 15 minutes per IP
- [ ] **Password Reset:**
  - Time-limited tokens (1 hour)
  - Single-use tokens
  - Email verification required

#### 3.1.2 Magic Links
- [ ] **Secure Token Generation:** Cryptographically random 32-byte tokens
- [ ] **Expiration:** 15 minutes default (configurable)
- [ ] **Single-use:** Token invalidated after use
- [ ] **Device Binding:** Optional device fingerprint validation

#### 3.1.3 One-Time Passwords (OTP)
- [ ] **TOTP:** RFC 6238 compliant
  - 6-digit codes
  - 30-second window
  - QR code generation
- [ ] **SMS OTP:**
  - Rate limited (3 per hour per phone)
  - Template customization
  - Fallback mechanisms

#### 3.1.4 Email Verification
- [ ] **Double-opt-in:** Required for sensitive operations
- [ ] **Link Format:** JWT-based with short expiry
- [ ] **Resend Policy:** Exponential backoff

### 3.2 Account Security

- [ ] **Brute Force Protection:** Progressive delays after failed attempts
- [ ] **Account Lockout:** Temporary (30 min) after 10 failed attempts
- [ ] **Suspicious Activity Detection:**
  - New device/location alerts
  - Impossible travel detection
  - Velocity checks
- [ ] **Concurrent Session Limits:** Configurable per user/org

---

## 4. Session Management

### 4.1 Token Strategy

We use a **dual-token approach** (Access Token + Refresh Token):

#### 4.1.1 Access Tokens (JWT)
```json
{
  "sub": "user_123",
  "org_id": "org_456",
  "session_id": "sess_789",
  "iat": 1700000000,
  "exp": 1700000600,
  "iss": "https://api.ourauth.com",
  "aud": "https://app.customer.com",
  "role": "admin",
  "permissions": ["read", "write"],
  "auth_method": "password",
  "mfa_verified": true
}
```

- **Lifetime:** 5-60 minutes (configurable)
- **Algorithm:** RS256 (asymmetric)
- **Rotation:** Not rotated automatically

#### 4.1.2 Refresh Tokens (Opaque)
- **Format:** Cryptographically random 128-character string
- **Storage:** Redis with TTL
- **Lifetime:** Sliding window, max 30 days
- **Rotation:** Strict rotation (new token issued, old invalidated)
- **Family Detection:** Detect token replay attacks

### 4.2 Session Types

| Session Type | Use Case | Storage |
|-------------|----------|---------|
| **Standard** | Web applications | HTTP-only cookies |
| **SPA** | Single-page apps | Memory + refresh token |
| **Mobile** | Native apps | Secure enclave/keystore |
| **API** | Machine-to-machine | Client credentials |

### 4.3 Session Security

- [ ] **HTTP-only Cookies:** `HttpOnly; Secure; SameSite=Strict`
- [ ] **CSRF Protection:** Double-submit cookie pattern
- [ ] **Session Fixation Prevention:** New session ID after login
- [ ] **Concurrent Session Control:** Limit active sessions per user
- [ ] **Remote Logout:** Invalidate all sessions endpoint

### 4.4 Session Configuration

Organizations can configure:
- Idle timeout (default: 30 min)
- Maximum lifetime (default: 7 days)
- Concurrent session limit (default: 5)
- MFA requirement for sensitive operations
- IP binding options

---

## 5. Organizations & Multi-tenancy

### 5.1 Organization Model

Organizations enable B2B SaaS use cases. A user can belong to multiple organizations.

```
User
├── Organization Membership 1 (Admin)
│   └── Organization A
│       ├── Team 1
│       └── Team 2
└── Organization Membership 2 (Member)
    └── Organization B
```

### 5.2 Membership Roles

| Role | Permissions |
|------|------------|
| **Owner** | Full control, billing, delete org |
| **Admin** | Manage members, settings, SSO |
| **Editor** | Most operations, no admin tasks |
| **Member** | Basic access, no sensitive operations |
| **Guest** | Limited access, external collaborators |

### 5.3 Organization Features

- [ ] **Custom Branding:** Logo, colors, email templates
- [ ] **Custom Domains:** `auth.customer.com`
- [ ] **Domain Restrictions:** Only allow @company.com emails
- [ ] **Approval Workflows:** New member approval required
- [ ] **Default Role Assignment:** Based on email domain
- [ ] **Seat Management:** Per-seat billing integration

### 5.4 Teams (Sub-organizations)

For large organizations, support nested teams:
- Hierarchical team structure
- Inherited permissions with override capability
- Team-specific resources

---

## 6. Enterprise SSO

### 6.1 SAML 2.0

#### 6.1.1 Service Provider (SP) Mode
We act as the SP, customer IdP as the identity source.

**Supported Bindings:**
- HTTP Redirect (for AuthnRequest)
- HTTP POST (for Assertion)
- HTTP Artifact (optional)

**Supported Features:**
- [ ] SP-initiated SSO
- [ ] IdP-initiated SSO
- [ ] Single Logout (SLO)
- [ ] Just-in-Time (JIT) provisioning
- [ ] Attribute mapping (email, name, groups, roles)
- [ ] SAML assertion encryption
- [ ] Signed AuthnRequests

**Attribute Mapping Example:**
```xml
<saml:AttributeStatement>
  <saml:Attribute Name="email">
    <saml:AttributeValue>user@company.com</saml:AttributeValue>
  </saml:Attribute>
  <saml:Attribute Name="groups">
    <saml:AttributeValue>engineering</saml:AttributeValue>
    <saml:AttributeValue>admin</saml:AttributeValue>
  </saml:Attribute>
</saml:AttributeStatement>
```

#### 6.1.2 Identity Provider (IdP) Mode
Allow third-party apps to authenticate against our user base.

- Metadata endpoint: `/.well-known/saml-metadata`
- Certificate rotation support

### 6.2 OIDC/OAuth 2.0

#### 6.2.1 As Provider (OAuth Server)
Full OAuth 2.0 + OIDC provider implementation.

**Flows Supported:**
- [ ] Authorization Code + PKCE (recommended)
- [ ] Client Credentials (M2M)
- [ ] Device Authorization Flow (IoT)
- [ ] Refresh Token Flow

**Endpoints:**
```
/.well-known/openid-configuration
/oauth/authorize
/oauth/token
/oauth/introspect
/oauth/revoke
/oauth/userinfo
/.well-known/jwks.json
```

**Claims Supported:**
- Standard: `sub`, `name`, `email`, `email_verified`, `picture`
- Custom: `org_id`, `org_role`, `permissions`, `mfa_verified`

#### 6.2.2 As Client (Social Login)
Connect to external IdPs.

**Built-in Providers:**
- Google
- Microsoft/Azure AD
- GitHub
- GitLab
- Apple
- LinkedIn
- Twitter/X
- Facebook
- Generic OIDC
- Generic SAML

### 6.3 SCIM 2.0 (Directory Sync)

Automated user provisioning from corporate directories.

**Features:**
- [ ] User provisioning/deprovisioning
- [ ] Group synchronization
- [ ] Attribute mapping
- [ ] Soft delete (deactivate vs delete)
- [ ] Real-time sync via webhooks
- [ ] Bulk operations

**Endpoints:**
```
/scim/v2/Users
/scim/v2/Groups
/scim/v2/ServiceProviderConfig
/scim/v2/ResourceTypes
/scim/v2/Schemas
```

**Sync Modes:**
1. **Push:** IdP pushes changes to us
2. **Pull:** We poll IdP for changes (fallback)
3. **Event-driven:** Real-time via webhooks

---

## 7. Passkeys & WebAuthn

### 7.1 WebAuthn Implementation

Full FIDO2/WebAuthn support for passwordless authentication.

#### 7.1.1 Registration Flow

```
1. User initiates passkey registration
2. Server generates challenge + options
3. Client calls navigator.credentials.create()
4. Authenticator generates key pair
5. Client sends attestation to server
6. Server verifies attestation
7. Store credential public key
```

**Attestation Types:**
- `none`: No attestation (privacy-preserving)
- `indirect`: Attestation via anonymization CA
- `direct`: Direct attestation from authenticator
- `enterprise`: Direct + enterprise attestation

#### 7.1.2 Authentication Flow

```
1. User initiates login
2. Server generates challenge
3. Client calls navigator.credentials.get()
4. Authenticator signs challenge
5. Client sends assertion to server
6. Server verifies signature
7. Issue session tokens
```

### 7.2 Passkey Types

| Type | Characteristics | Use Case |
|------|----------------|----------|
| **Platform** | Device-bound (TouchID, FaceID) | Primary device authentication |
| **Roaming** | Cross-device (YubiKey) | Hardware security keys |
| **Synced** | Cloud-synced (Apple Keychain, Google Password Manager) | Multi-device seamless experience |

### 7.3 Passkey Management

- [ ] **Multiple Passkeys:** User can register multiple passkeys
- [ ] **Passkey Metadata:** Name, device info, last used
- [ ] **Revocation:** Remove lost/compromised passkeys
- [ ] **Backup Requirements:** Enforce MFA or backup codes
- [ ] **Resident Key Support:** For hardware keys

### 7.4 Database Schema (Passkeys)

```sql
CREATE TABLE webauthn_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    credential_id BYTEA NOT NULL,
    public_key BYTEA NOT NULL,
    sign_count INTEGER DEFAULT 0,
    attestation_type VARCHAR(50),
    aaguid UUID,
    friendly_name VARCHAR(255),
    device_type VARCHAR(50), -- 'platform', 'cross-platform'
    is_synced BOOLEAN DEFAULT FALSE,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, credential_id)
);
```

---

## 8. Social Login & OAuth

### 8.1 OAuth 2.0 Flow Implementation

**Authorization Code Flow with PKCE:**
```
┌─────────┐                                    ┌─────────────┐
│   App   │                                    │ Auth Server │
└────┬────┘                                    └──────┬──────┘
     │                                                │
     │ 1. Authorize (code_challenge)                  │
     │───────────────────────────────────────────────>│
     │                                                │
     │ 2. Redirect with authorization code            │
     │<───────────────────────────────────────────────│
     │                                                │
     │ 3. Token request (code_verifier)               │
     │───────────────────────────────────────────────>│
     │                                                │
     │ 4. Access token + ID token                     │
     │<───────────────────────────────────────────────│
```

### 8.2 Built-in Providers

Each provider configured with:
- Client ID/Secret
- Scopes requested
- Attribute mapping
- Account linking strategy

### 8.3 Account Linking

Strategies for handling same email across providers:
1. **Automatic:** Link if email verified on both
2. **Prompt User:** Ask user to confirm linking
3. **Disabled:** Keep accounts separate

---

## 9. Security Features

### 9.1 Multi-Factor Authentication (MFA)

#### 9.1.1 MFA Methods
- [ ] **TOTP:** Authenticator apps (Google, Authy, 1Password)
- [ ] **SMS:** Phone number verification
- [ ] **WebAuthn:** Hardware keys, platform authenticators
- [ ] **Backup Codes:** Single-use recovery codes
- [ ] **Email:** Fallback method

#### 9.1.2 MFA Policies

| Policy | Behavior |
|--------|----------|
| **Optional** | User decides whether to enable |
| **Required** | All users must set up MFA |
| **Risk-based** | Trigger MFA on suspicious activity |
| **Step-up** | Require MFA for sensitive operations |

#### 9.1.3 MFA Enforcement Levels

- **App-level:** All users of the application
- **Org-level:** All members of an organization
- **Role-level:** Based on user role (e.g., admins)
- **Operation-level:** Specific sensitive operations

### 9.2 Rate Limiting

Multi-layer rate limiting:

| Layer | Scope | Limits |
|-------|-------|--------|
| IP-based | Per IP | 100 req/min |
| User-based | Per user | 10 login attempts/15min |
| Organization | Per org | 1000 req/min |
| Endpoint | Per endpoint | Configurable |

**Rate Limit Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1700000000
```

### 9.3 Audit Logging

Comprehensive audit trail for compliance (SOC 2, ISO 27001, GDPR).

**Event Types:**
- User events: login, logout, password change, MFA setup
- Admin events: user created, deleted, role changed
- Organization events: member added/removed, SSO config changed
- Security events: suspicious login, MFA challenge failed

**Log Format:**
```json
{
  "timestamp": "2024-01-01T12:00:00Z",
  "event_type": "user.login",
  "event_id": "evt_123",
  "actor": {
    "type": "user",
    "id": "user_456",
    "email": "user@example.com"
  },
  "target": {
    "type": "session",
    "id": "sess_789"
  },
  "context": {
    "ip": "192.168.1.1",
    "user_agent": "Mozilla/5.0...",
    "location": "San Francisco, CA"
  },
  "metadata": {
    "method": "password",
    "mfa_used": true
  }
}
```

**Retention:**
- Real-time: 30 days
- Archive: 7 years (configurable)
- Export: CSV, JSON, SIEM formats

### 9.4 Data Protection

- [ ] **Encryption at Rest:** AES-256
- [ ] **Encryption in Transit:** TLS 1.3 minimum
- [ ] **Field-level Encryption:** SSN, tax IDs
- [ ] **Key Rotation:** Automatic 90-day rotation
- [ ] **Secure Key Storage:** AWS KMS / HashiCorp Vault

### 9.5 Compliance

- [ ] **GDPR:** Data portability, right to erasure
- [ ] **SOC 2 Type II:** Annual audit
- [ ] **ISO 27001:** Information security
- [ ] **HIPAA:** BAA available
- [ ] **PCI DSS:** No card data storage

---

## 10. Admin Dashboard

### 10.1 Dashboard Features

#### 10.1.1 Overview
- Active users (real-time)
- Login activity graph
- Security events
- Organization growth

#### 10.1.2 User Management
- Search/filter users
- View user details
- Impersonate user (with audit log)
- Reset password
- Manage MFA
- Delete user (GDPR right to erasure)

#### 10.1.3 Organization Management
- View all organizations
- Manage organization settings
- Configure SSO
- View organization members
- Transfer ownership

#### 10.1.4 Settings
- Application configuration
- Email template customization
- Branding settings
- Security policies
- API keys management
- Webhook configuration

### 10.2 Analytics

**Metrics Tracked:**
- Daily/Monthly Active Users (DAU/MAU)
- Sign-up conversion rate
- Login success/failure rates
- MFA adoption rate
- Password reset requests
- Session duration
- Device/browser breakdown

**Export Formats:**
- CSV
- JSON
- Webhook to analytics platforms

---

## 11. SDKs & APIs

### 11.1 Frontend SDKs

#### 11.1.1 React SDK

```typescript
import { ClerkProvider, SignedIn, SignedOut } from '@ourauth/react';

function App() {
  return (
    <ClerkProvider publishableKey="pk_test_...">
      <SignedIn>
        <Dashboard />
      </SignedIn>
      <SignedOut>
        <SignIn />
      </SignedOut>
    </ClerkProvider>
  );
}
```

**Hooks:**
- `useUser()` - Current user data
- `useSession()` - Session information
- `useOrganization()` - Current org context
- `useAuth()` - Auth state and methods
- `useSignIn()` - Sign-in flow control
- `useSignUp()` - Sign-up flow control

#### 11.1.2 Pre-built Components

- `<SignIn />` - Complete sign-in UI
- `<SignUp />` - Complete sign-up UI
- `<UserButton />` - User menu with avatar
- `<OrganizationSwitcher />` - Org selection
- `<Protect />` - Route protection
- `<RedirectToSignIn />` - Auth redirect

### 11.2 Backend SDKs

#### 11.2.1 Node.js/Express

```typescript
import { authMiddleware, requireAuth } from '@ourauth/express';

app.use(authMiddleware());

app.get('/api/protected', requireAuth(), (req, res) => {
  res.json({ userId: req.auth.userId });
});
```

#### 11.2.2 Python/FastAPI

```python
from ourauth.fastapi import auth_required

@app.get("/api/protected")
@auth_required
async def protected_route(user: User = Depends(get_current_user)):
    return {"user_id": user.id}
```

#### 11.2.3 Go

```go
import "github.com/ourauth/go-sdk"

func main() {
    client := ourauth.NewClient("sk_test_...")
    http.Handle("/api/protected", client.RequireAuth(protectedHandler))
}
```

### 11.3 REST API

#### Authentication
```
POST /v1/users
GET  /v1/users/{user_id}
POST /v1/users/{user_id}/delete

POST /v1/organizations
GET  /v1/organizations/{org_id}
POST /v1/organizations/{org_id}/memberships

POST /v1/sessions
DELETE /v1/sessions/{session_id}
POST /v1/sessions/{session_id}/revoke

POST /v1/invitations
GET  /v1/invitations/{invitation_id}
```

#### Rate Limits
- 100 requests/minute per API key
- 1000 requests/minute per organization

### 11.4 Webhooks

**Event Types:**
- `user.created`
- `user.updated`
- `user.deleted`
- `session.created`
- `session.revoked`
- `organization.created`
- `organization_membership.created`
- `organization_invitation.accepted`

**Webhook Payload:**
```json
{
  "type": "user.created",
  "data": {
    "id": "user_123",
    "email": "user@example.com",
    "created_at": "2024-01-01T00:00:00Z"
  },
  "timestamp": "2024-01-01T00:00:00Z",
  "id": "evt_456"
}
```

**Security:**
- Signed with HMAC-SHA256
- Replay attack prevention (timestamp tolerance)
- Retry logic with exponential backoff
- Idempotency keys

---

## 12. Database Schema

### 12.1 Core Tables

#### Users
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    password_hash VARCHAR(255), -- NULL for SSO-only users
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    avatar_url TEXT,
    last_sign_in_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP, -- Soft delete
    
    -- MFA settings
    mfa_enabled BOOLEAN DEFAULT FALSE,
    mfa_backup_codes TEXT[], -- Encrypted
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Constraints
    CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_created_at ON users(created_at);
```

#### Organizations
```sql
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    logo_url TEXT,
    
    -- Branding
    primary_color VARCHAR(7),
    favicon_url TEXT,
    
    -- Settings
    max_members INTEGER,
    allowed_domains TEXT[],
    require_email_verification BOOLEAN DEFAULT TRUE,
    
    -- SSO settings
    saml_enabled BOOLEAN DEFAULT FALSE,
    saml_config JSONB,
    
    -- SCIM settings
    scim_enabled BOOLEAN DEFAULT FALSE,
    scim_token_hash VARCHAR(255),
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP
);

CREATE INDEX idx_organizations_slug ON organizations(slug) WHERE deleted_at IS NULL;
```

#### Organization Memberships
```sql
CREATE TABLE organization_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'member',
    
    -- Metadata
    permissions JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id, organization_id)
);

CREATE INDEX idx_memberships_org ON organization_memberships(organization_id);
CREATE INDEX idx_memberships_user ON organization_memberships(user_id);
```

#### Sessions
```sql
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Token info
    refresh_token_hash VARCHAR(255) NOT NULL,
    refresh_token_family UUID NOT NULL,
    
    -- Session metadata
    ip_address INET,
    user_agent TEXT,
    device_fingerprint VARCHAR(255),
    
    -- Timestamps
    expires_at TIMESTAMP NOT NULL,
    last_active_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    revoked_at TIMESTAMP,
    revoked_reason VARCHAR(100)
);

CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_refresh ON sessions(refresh_token_hash);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

#### OAuth Accounts (Social Login)
```sql
CREATE TABLE oauth_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    provider_account_id VARCHAR(255) NOT NULL,
    
    -- Token storage (encrypted)
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    expires_at TIMESTAMP,
    
    -- Profile data from provider
    scope TEXT,
    profile_data JSONB,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(provider, provider_account_id)
);

CREATE INDEX idx_oauth_user ON oauth_accounts(user_id);
```

#### Audit Logs
```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    event_id VARCHAR(255) UNIQUE NOT NULL,
    
    -- Actor (who performed the action)
    actor_type VARCHAR(50),
    actor_id UUID,
    actor_email VARCHAR(255),
    
    -- Target (what was affected)
    target_type VARCHAR(50),
    target_id UUID,
    
    -- Context
    ip_address INET,
    user_agent TEXT,
    organization_id UUID,
    
    -- Event data
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Partition by month for performance
CREATE INDEX idx_audit_org ON audit_logs(organization_id, created_at);
CREATE INDEX idx_audit_user ON audit_logs(actor_id, created_at);
CREATE INDEX idx_audit_event ON audit_logs(event_type, created_at);
```

#### Applications (API Keys)
```sql
CREATE TABLE applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- API Keys
    publishable_key VARCHAR(255) UNIQUE NOT NULL,
    secret_key_hash VARCHAR(255), -- NULL for frontend-only apps
    
    -- Settings
    allowed_origins TEXT[],
    allowed_redirect_uris TEXT[],
    
    -- Features
    features JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP
);

CREATE INDEX idx_apps_org ON applications(organization_id);
CREATE INDEX idx_apps_publishable ON applications(publishable_key);
```

### 12.2 Row Level Security (RLS)

Enable RLS for multi-tenant data isolation:

```sql
-- Enable RLS on tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own data
CREATE POLICY user_isolation ON users
    FOR ALL
    USING (id = current_setting('app.current_user_id')::UUID);

-- Policy: Org members can see other members
CREATE POLICY org_membership_isolation ON organization_memberships
    FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id 
            FROM organization_memberships 
            WHERE user_id = current_setting('app.current_user_id')::UUID
        )
    );
```

---

## 13. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-4)
**Goal:** Core authentication working

- [ ] Project setup (monorepo, CI/CD)
- [ ] Database schema implementation
- [ ] Basic user registration/login
- [ ] Password hashing and validation
- [ ] Session management (JWT + refresh tokens)
- [ ] Email verification
- [ ] Password reset flow
- [ ] Basic React SDK
- [ ] Basic Node.js SDK

### Phase 2: Social & MFA (Weeks 5-8)
**Goal:** Modern auth methods

- [ ] OAuth 2.0 / OIDC provider implementation
- [ ] Social login providers (Google, GitHub, Microsoft)
- [ ] TOTP MFA
- [ ] SMS MFA
- [ ] Backup codes
- [ ] Account linking
- [ ] Magic links

### Phase 3: Organizations (Weeks 9-12)
**Goal:** B2B support

- [ ] Organization CRUD
- [ ] Membership management
- [ ] Role-based access control
- [ ] Organization-level settings
- [ ] Invitations system
- [ ] Teams/sub-organizations

### Phase 4: Enterprise SSO (Weeks 13-16)
**Goal:** Enterprise-ready

- [ ] SAML 2.0 SP implementation
- [ ] SAML 2.0 IdP implementation
- [ ] SCIM 2.0 server
- [ ] Directory sync
- [ ] Custom domains
- [ ] Domain restrictions

### Phase 5: Passkeys (Weeks 17-20)
**Goal:** Passwordless future

- [ ] WebAuthn server implementation
- [ ] Passkey registration
- [ ] Passkey authentication
- [ ] Multi-device passkey support
- [ ] Passkey management UI

### Phase 6: Security & Compliance (Weeks 21-24)
**Goal:** Production-ready

- [ ] Comprehensive audit logging
- [ ] Rate limiting
- [ ] Brute force protection
- [ ] Suspicious activity detection
- [ ] GDPR compliance features
- [ ] Data export/deletion
- [ ] Security headers
- [ ] Penetration testing

### Phase 7: Admin Dashboard (Weeks 25-28)
**Goal:** Complete admin experience

- [ ] Dashboard UI
- [ ] User management
- [ ] Organization management
- [ ] Analytics
- [ ] Settings panels
- [ ] Webhook management

### Phase 8: SDKs & Polish (Weeks 29-32)
**Goal:** Developer experience

- [ ] Vue.js SDK
- [ ] Python SDK
- [ ] Go SDK
- [ ] Mobile SDKs (React Native, Flutter)
- [ ] Documentation
- [ ] Example applications
- [ ] Self-hosting guide

---

## 14. TODO Checklist

### Core Infrastructure
- [ ] Set up monorepo with Turborepo
- [ ] Configure CI/CD pipeline (GitHub Actions)
- [ ] Set up development environment with Docker Compose
- [ ] Configure PostgreSQL with proper extensions
- [ ] Set up Redis cluster
- [ ] Configure message queue (RabbitMQ)
- [ ] Set up observability (logging, metrics, tracing)
- [ ] Configure multi-region deployment

### Authentication Core
- [ ] Implement Argon2id password hashing
- [ ] Create user registration endpoint
- [ ] Create user login endpoint
- [ ] Implement JWT token generation/validation
- [ ] Implement refresh token rotation
- [ ] Create password reset flow
- [ ] Create email verification flow
- [ ] Implement rate limiting middleware
- [ ] Create session management service
- [ ] Implement device fingerprinting

### Database & Storage
- [ ] Create users table with indexes
- [ ] Create organizations table
- [ ] Create organization_memberships table
- [ ] Create sessions table
- [ ] Create oauth_accounts table
- [ ] Create webauthn_credentials table
- [ ] Create audit_logs table with partitioning
- [ ] Create applications table
- [ ] Implement RLS policies
- [ ] Set up database migrations system

### OAuth & Social Login
- [ ] Implement OAuth 2.0 authorization server
- [ ] Create OAuth client management
- [ ] Implement authorization code flow with PKCE
- [ ] Implement client credentials flow
- [ ] Add Google OAuth provider
- [ ] Add GitHub OAuth provider
- [ ] Add Microsoft OAuth provider
- [ ] Add Apple OAuth provider
- [ ] Implement account linking logic
- [ ] Create OAuth consent screen

### MFA & Security
- [ ] Implement TOTP generation/verification
- [ ] Create QR code generation for TOTP setup
- [ ] Implement SMS OTP with Twilio
- [ ] Create backup codes generation
- [ ] Implement MFA policy enforcement
- [ ] Add brute force protection
- [ ] Implement suspicious activity detection
- [ ] Create IP allowlisting/blocklisting
- [ ] Implement CAPTCHA integration

### Organizations
- [ ] Create organization CRUD endpoints
- [ ] Implement membership management
- [ ] Create role-based permissions system
- [ ] Build invitation system
- [ ] Implement organization settings
- [ ] Add custom domain support
- [ ] Create domain restriction logic
- [ ] Implement organization-level MFA policies

### Enterprise SSO
- [ ] Implement SAML 2.0 request parsing
- [ ] Create SAML assertion validation
- [ ] Build SAML metadata generation
- [ ] Implement SAML single logout
- [ ] Create attribute mapping system
- [ ] Implement SCIM 2.0 endpoints
- [ ] Build user provisioning logic
- [ ] Create group synchronization
- [ ] Implement Just-in-Time provisioning

### Passkeys & WebAuthn
- [ ] Implement WebAuthn credential creation
- [ ] Create WebAuthn assertion verification
- [ ] Build credential storage schema
- [ ] Implement attestation validation
- [ ] Add passkey management endpoints
- [ ] Create passkey registration UI
- [ ] Implement passkey authentication flow
- [ ] Add backup credential enforcement

### APIs & SDKs
- [ ] Build REST API v1
- [ ] Create OpenAPI specification
- [ ] Implement API authentication
- [ ] Build React SDK
- [ ] Create pre-built UI components
- [ ] Implement React hooks (useUser, useSession, etc.)
- [ ] Build Express.js middleware
- [ ] Create FastAPI integration
- [ ] Build Go SDK
- [ ] Implement webhook system

### Admin Dashboard
- [ ] Create dashboard layout and navigation
- [ ] Build user management interface
- [ ] Create organization management UI
- [ ] Implement analytics dashboard
- [ ] Build settings panels
- [ ] Create webhook configuration UI
- [ ] Implement audit log viewer
- [ ] Add impersonation feature

### Documentation & Examples
- [ ] Write API documentation
- [ ] Create SDK documentation
- [ ] Write self-hosting guide
- [ ] Create quickstart tutorials
- [ ] Build example applications
  - [ ] Next.js full-stack example
  - [ ] React SPA example
  - [ ] Express.js API example
  - [ ] Python/FastAPI example
- [ ] Create architecture diagrams
- [ ] Write security whitepaper

### Testing & Quality
- [ ] Set up unit testing framework
- [ ] Write unit tests for auth logic
- [ ] Create integration tests
- [ ] Implement E2E tests
- [ ] Set up load testing
- [ ] Perform security audit
- [ ] Conduct penetration testing
- [ ] Set up automated vulnerability scanning

### DevOps & Deployment
- [ ] Create Kubernetes manifests
- [ ] Set up Terraform for infrastructure
- [ ] Configure auto-scaling
- [ ] Set up database backups
- [ ] Configure disaster recovery
- [ ] Set up monitoring and alerting
- [ ] Create runbooks for incidents
- [ ] Document deployment procedures

---

## Appendix A: Security Checklist

### Authentication Security
- [ ] Use Argon2id for password hashing
- [ ] Implement proper session timeout
- [ ] Use HTTP-only, Secure, SameSite cookies
- [ ] Implement CSRF protection
- [ ] Validate all inputs
- [ ] Use parameterized queries
- [ ] Implement rate limiting

### OAuth Security
- [ ] Enforce PKCE for public clients
- [ ] Validate redirect URIs strictly
- [ ] Use state parameter
- [ ] Short-lived authorization codes (10 min)
- [ ] Rotate refresh tokens

### SAML Security
- [ ] Validate SAML signatures
- [ ] Check assertion timestamps
- [ ] Validate InResponseTo
- [ ] Use secure XML parsing
- [ ] Encrypt assertions if required

### WebAuthn Security
- [ ] Verify origin matches RP ID
- [ ] Check challenge matches
- [ ] Validate attestation when required
- [ ] Store credential IDs securely
- [ ] Check sign count for replay detection

---

## Appendix B: Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Login latency | < 200ms | P95 |
| Token validation | < 10ms | P99 |
| Session refresh | < 100ms | P95 |
| OAuth redirect | < 50ms | P99 |
| SAML response | < 500ms | P95 |
| Database queries | < 50ms | P99 |
| API availability | 99.99% | Uptime |
| Throughput | 10k req/s | Per region |

---

## Appendix C: Pricing Structure (Proposed)

| Plan | Price | MAUs | Features |
|------|-------|------|----------|
| **Free** | $0 | 10,000 | Core auth, Social login, Basic MFA |
| **Pro** | $25/mo + $0.01/MAU | Unlimited | Everything in Free + Organizations, Advanced MFA, Custom domains |
| **Business** | $99/mo + $0.02/MAU | Unlimited | Everything in Pro + SAML SSO, SCIM, Audit logs |
| **Enterprise** | Custom | Unlimited | Everything + SLA, Dedicated support, Custom contracts |

**Add-ons:**
- Enhanced Security Pack: $50/mo (Passkeys, Advanced threat detection)
- Compliance Pack: $100/mo (Extended audit retention, Compliance reports)

---

**Document End**

*This PRD is a living document. Update as requirements evolve.*


---

## Development Workflow & Git Practices

### Git Commit Strategy
- [ ] **Commit after every test pass** - Each passing test suite must be committed
  - Unit tests pass → commit
  - Integration tests pass → commit
  - E2E tests pass → commit
  - Use current git config (user.name, user.email) for all commits
  - Write descriptive commit messages following conventional commits format
  - Example: `feat(auth): implement Argon2id password hashing`

### Commit Message Convention
```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types: feat, fix, docs, style, refactor, test, chore, security

### Pre-commit Requirements
- [ ] All tests must pass before commit
- [ ] Linter must pass (ESLint/Prettier)
- [ ] TypeScript compilation must succeed
- [ ] No console.log statements in production code
- [ ] Security scan must pass

---

## Appendix D: Git Workflow & CI/CD Integration

### Git Commit After Test Pass Policy

**MANDATORY:** Every passing test must result in a commit under the current git configuration.

#### Workflow
1. Write test for feature/fix
2. Run tests locally
3. If tests pass → commit immediately with descriptive message
4. Push to remote repository
5. CI/CD pipeline runs tests again
6. If CI tests pass → deployment proceeds

#### Git Configuration Requirements
- [ ] Configure git user.name (use current system config)
- [ ] Configure git user.email (use current system config)
- [ ] Set up commit signing (GPG/SSH) for security
- [ ] Configure commit template for consistency
- [ ] Set up pre-commit hooks for automated checks

#### Automated Commit Script
```bash
#!/bin/bash
# commit-after-test.sh

run_tests() {
  npm run test:unit
  npm run test:integration
  npm run test:e2e
}

if run_tests; then
  git add .
  git commit -m "test: $(date +%Y-%m-%d-%H:%M) - all tests passing"
  git push
  echo "✅ Tests passed and changes committed"
else
  echo "❌ Tests failed - fix before committing"
  exit 1
fi
```

#### CI/CD Integration
- [ ] GitHub Actions workflow for automated testing
- [ ] Automated commit on test pass in CI
- [ ] Branch protection rules (require PR + tests)
- [ ] Automated semantic versioning based on commits
- [ ] Changelog generation from commit messages

**Document End**

*This PRD is a living document. Update as requirements evolve.*