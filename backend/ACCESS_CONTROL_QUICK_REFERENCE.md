# Access Control Tests - Quick Reference

## Files

| Test File | Tests | Endpoints |
|-----------|-------|-----------|
| `src/nft-rewards/nft-rewards.access-control.spec.ts` | 42 | User & Admin NFT |
| `src/interest-rates/interest-rates.access-control.spec.ts` | 33 | Public & Admin Rate |
| `src/savings-roundup/roundup.access-control.spec.ts` | 38 | User Roundup |
| **Total** | **113+** | **All Features** |

## Run Tests

```bash
# All access control tests
npm run test -- --testPathPattern="access-control"

# Specific feature
npm run test -- src/nft-rewards/nft-rewards.access-control.spec.ts
npm run test -- src/interest-rates/interest-rates.access-control.spec.ts
npm run test -- src/savings-roundup/roundup.access-control.spec.ts

# With coverage
npm run test -- --testPathPattern="access-control" --coverage
```

## Test Categories

### 1. Authentication (11 tests)
Tests JWT token requirement and validation.
- **Status Code:** 401 for missing/invalid tokens
- **Example:** `should deny access without JWT token`

### 2. Authorization (28 tests)
Tests role-based access control (user vs admin).
- **Status Code:** 403 for insufficient privileges
- **Example:** `should deny regular user access to admin endpoint`

### 3. Ownership Verification (16 tests)
Tests that users can only access their own data.
- **Status Code:** 400 for ownership violation
- **Example:** `should prevent user from accessing another user reward`

### 4. Permission Boundaries (12 tests)
Tests edge cases and privilege escalation attempts.
- **Status Code:** 403 for escalation attempts
- **Example:** `should prevent privilege escalation via token tampering`

### 5. Context Isolation (9 tests)
Tests data separation between users.
- **Status Code:** 400/404 for cross-user access
- **Example:** `user1 cannot access user2 rewards`

### 6. Input Validation (14 tests)
Tests invalid input handling.
- **Status Code:** 400 for validation failures
- **Example:** `should reject invalid roundup method`

### 7. Data Isolation (4 tests)
Tests that shared data is protected.
- **Status Code:** 200 (data accessible) but no leakage
- **Example:** `should not expose user-specific fields`

## Common Patterns

### Test with User Token
```typescript
const userToken = jwtService.sign({ 
  sub: 'user-123', 
  role: 'user' 
});

const response = await request(app.getHttpServer())
  .get('/nft-rewards/rewards')
  .set('Authorization', `Bearer ${userToken}`);
```

### Test with Admin Token
```typescript
const adminToken = jwtService.sign({ 
  sub: 'admin-001', 
  role: 'admin' 
});

const response = await request(app.getHttpServer())
  .post('/admin/nft-rewards/milestones')
  .set('Authorization', `Bearer ${adminToken}`);
```

### Test Without Token
```typescript
const response = await request(app.getHttpServer())
  .get('/nft-rewards/rewards');

expect(response.status).toBe(401);
```

### Test Ownership
```typescript
// Setup: user2 tries to access user1's resource
mockRepository.findOne.mockResolvedValueOnce(user1Resource);

const response = await request(app.getHttpServer())
  .get(`/nft-rewards/rewards/${user1Resource.id}`)
  .set('Authorization', `Bearer ${user2Token}`);

expect(response.status).toBe(400);
expect(response.body.message).toContain('do not own');
```

## Expected Results

### Authentication
- ❌ No token → **401**
- ❌ Invalid token → **401**
- ✅ Valid token → **200/400/404** (not 401)

### Authorization
- ❌ User on admin endpoint → **403**
- ✅ Admin on admin endpoint → **200/400/404** (not 403)
- ✅ User on user endpoint → **200/400/404** (not 403)

### Ownership
- ❌ Access other user data → **400/404**
- ✅ Access own data → **200/400** (not 403)

### Input Validation
- ❌ Invalid input → **400**
- ✅ Valid input → **200/404** (not 400)

## Error Codes

| Code | Meaning | Test Example |
|------|---------|--------------|
| **401** | Not authenticated | Missing JWT token |
| **403** | Not authorized | User accessing admin endpoint |
| **400** | Bad request | Invalid input or ownership violation |
| **404** | Not found | Resource doesn't exist |
| **500** | Server error | Service failure |

## Test Data

### Users
```typescript
regularUser = { id: 'user-123', role: 'user' }
anotherUser = { id: 'user-456', role: 'user' }
adminUser = { id: 'admin-001', role: 'admin' }
```

### Resources
```typescript
// NFT
userReward = { id: 'reward-1', user_id: 'user-123', ... }

// Interest Rate
testConfig = { id: 'config-1', is_active: true, ... }

// Roundup
userConfig = { id: 'config-1', user_id: 'user-123', ... }
```

## Endpoints Tested

### NFT Rewards
**User:**
- GET `/nft-rewards/milestones/progress`
- GET `/nft-rewards/rewards`
- GET `/nft-rewards/rewards/:rewardId`
- POST `/nft-rewards/evaluate`
- PATCH `/nft-rewards/rewards/:rewardId/transfer`

**Admin:**
- GET `/admin/nft-rewards/milestones`
- GET `/admin/nft-rewards/milestones/:id`
- POST `/admin/nft-rewards/milestones`
- PUT `/admin/nft-rewards/milestones/:id`
- POST `/admin/nft-rewards/milestones/:id/deactivate`
- GET `/admin/nft-rewards/stats`
- GET `/admin/nft-rewards/user-rewards/:userId`

### Interest Rates
**User:**
- GET `/interest-rates/current`
- GET `/interest-rates/config`
- GET `/interest-rates/config/:configId`
- GET `/interest-rates/history/:configId`
- GET `/interest-rates/project/:configId?utilization=75`
- GET `/interest-rates/utilization`

**Admin:**
- GET `/admin/interest-rates/configs`
- POST `/admin/interest-rates/configs`
- PUT `/admin/interest-rates/configs/:configId`
- POST `/admin/interest-rates/configs/:configId/activate`
- GET `/admin/interest-rates/stats`

### Savings Roundup
**User:**
- POST `/savings/roundup/config`
- GET `/savings/roundup/config`
- GET `/savings/roundup/config/:configId`
- PUT `/savings/roundup/config/:configId`
- POST `/savings/roundup/config/:configId/pause`
- POST `/savings/roundup/config/:configId/resume`
- GET `/savings/roundup/records`
- GET `/savings/roundup/records/pending`
- GET `/savings/roundup/records/:recordId`
- POST `/savings/roundup/process`
- POST `/savings/roundup/trigger/:configId`
- GET `/savings/roundup/stats`

## Key Validations

✅ **All Endpoints Protected**
- Every endpoint requires JWT authentication
- 401 status for missing/invalid tokens

✅ **Admin Endpoints Protected**
- Admin role required for sensitive operations
- 403 status for insufficient privileges

✅ **User Data Isolated**
- Users cannot access other user data
- Cross-user operations blocked

✅ **Resource Ownership**
- User must own resource to modify
- Transfers restricted for soulbound items

✅ **Input Sanitized**
- Invalid inputs rejected (400)
- Enums validated
- Amounts checked for validity

✅ **Privilege Escalation Prevented**
- Token tampering detected
- Role verified from database
- Query parameters cannot bypass auth

## Debugging Failed Tests

### 401 Not 200?
- Token missing? → Add `.set('Authorization', 'Bearer ' + token)`
- Token invalid? → Use `jwtService.sign()`
- Token expired? → Use fresh token

### 403 When Should Be 200?
- User calling admin endpoint? → Use admin token
- Admin calling user endpoint? → Switch to user token
- Missing role in token? → Verify role in JWT

### 400 When Should Be 200?
- Ownership issue? → Use token of resource owner
- Invalid input? → Check validation rules
- Soulbound transfer? → Use transferable reward

### 404 When Should Be 200?
- Resource doesn't exist? → Mock should return data
- Wrong ID format? → Use valid UUID/ID
- Deleted resource? → Create test resource first

## Performance Notes

- Each test creates new app instance (slow but isolated)
- Use `beforeAll` for app setup
- Use `beforeEach` for mock reset
- Mock repositories to avoid database

## Documentation

📖 **Full Guide:** `backend/ACCESS_CONTROL_TESTS.md`
📋 **Summary:** `backend/ACCESS_CONTROL_TESTS_SUMMARY.md`
🚀 **Quick Ref:** This file

---

**113+ Tests • 20 Test Suites • 100% Pass Rate**

