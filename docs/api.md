# API
Describes the HTTP API of Chairtime. Relies on roles.md and data-model.md.

## 1. Conventions

### Base URL 
`/api/v1` 

If a change breaks current clients, `/api/v2` appears, while `v1` continues to work, until old clients are updated.

### Auth
- header - `Authorization: Bearer <access token>`;
- no token/token invalid - 401
- token without role - 403
- refresh - TODO

### Formats
- JSON, fields in camelCase
- ID - UUID-strings
- moments (bookings, orders) - ISO 8601 in UTC
- time in the schedule - local Europe/Warsaw time in HH:mm format
- money - integer in grosze

### Errors
- Body: statusCode, message, error, details (field-level validation errors)
  
- 400 - invalid request
- 401/403 - token error
- 404 - not found
- 409 - the request is correct, but is conflicting with a current state
e.g. slot is already taken, phone is already registered

### Pagination 
- offset: parameters page and limit, 20 by default, 100 max
- response: items and total

## 2. Endpoints

### Services
| Method | Path | Access | Notes |
|--------|:------:|:--------:|:-------:|
| POST | /services | Admin, Owner | Duration must be a multiple of 15 min. Price is set per barber, not here |
| PATCH | /services/:id | Admin, Owner | Deactivation: set isActive to false. Services are never deleted |
| GET | /services | Public | Only active services are returned, except for Admin and Owner |
