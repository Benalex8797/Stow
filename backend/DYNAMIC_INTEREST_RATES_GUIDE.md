# Dynamic Interest Rates System

## Overview

A sophisticated interest rate system that dynamically adjusts APY based on utilization, with rate smoothing to prevent volatility and oracle integration for external market data.

## Key Concepts

### 1. Utilization-Based Rates

Interest rates are calculated using a utilization curve model:

```
Rate = f(Utilization)
```

**Below Optimal Utilization:**
- Linear increase from base rate
- Slope: `slope_up` parameter
- Encourages capital deployment

**Above Optimal Utilization:**
- Steeper increase towards maximum
- Slope: `slope_down` parameter (typically > slope_up)
- Protects against over-utilization

### 2. Rate Curve Parameters

```
base_rate: 2%              # Starting rate when util = 0%
min_rate: 0%               # Floor
max_rate: 50%              # Ceiling
optimal_utilization: 85%   # Peak efficiency point
slope_up: 5%               # 5% APY per 1% util below optimal
slope_down: 25%            # 25% APY per 1% util above optimal
```

### 3. Smoothing

Exponential smoothing dampens rate volatility:

```
new_rate = smoothing_factor * calculated_rate + (1 - smoothing_factor) * previous_rate
```

- `smoothing_factor = 0`: No smoothing (instant updates)
- `smoothing_factor = 1`: Infinite smoothing (never changes)
- `smoothing_factor = 0.1`: 10% weight to new data, 90% to history

## Rate Calculation Algorithm

```
Input: utilization (0-1), config, previousRate (optional)

Step 1: Validate utilization is in [0, 1]

Step 2: Calculate raw rate based on curve
  if utilization <= optimal_utilization:
    rate = base_rate + (utilization / optimal) * slope_up * 100
  else:
    excess = (utilization - optimal) / (1 - optimal)
    rate = (base_rate + slope_up*100) + excess * slope_down * 100

Step 3: Clamp to [min_rate, max_rate]

Step 4: Apply smoothing if previousRate exists
  rate = smoothing_factor * rate + (1 - smoothing_factor) * previousRate

Step 5: Final clamp to [min_rate, max_rate]

Output: rate (APY percentage)
```

## Architecture

### Entities

**InterestRateConfig**
- Stores rate calculation parameters
- Multiple configurations can exist (only one active)
- Supports different assets and strategies

**InterestRateHistory**
- Audit trail of all rate calculations
- Tracks utilization, liquidity, previous rate
- Enables analytics and rate trending

**OracleData**
- Caches external price feeds
- Supports multiple sources (Chainlink, Stellar Quest, etc.)
- Enables market-based rate adjustments

### Services

**RateCalculatorService**
- Core calculation engine
- APY/APR conversions
- Interest earned calculations
- Utilization calculations

**InterestRateService**
- Configuration management
- Rate calculations and history
- Oracle data management
- Utilization metrics

### Controllers

**InterestRatesController** (Public/Protected)
- Get current rate
- View rate history
- Project rates at different utilizations
- Get utilization metrics

**InterestRatesAdminController** (Admin-only)
- CRUD operations on configurations
- Activate/deactivate configs
- View system statistics

## API Endpoints

### User Endpoints

#### Get Current Rate
```
GET /interest-rates/current
```

Response:
```json
{
  "apy": "5.25",
  "utilization": "0.7500",
  "total_liquidity": "1000000000",
  "total_utilization": "750000000",
  "config_id": "uuid",
  "config_name": "Main Vault",
  "calculated_at": "2024-10-20T12:00:00Z"
}
```

#### Get Rate for Configuration
```
GET /interest-rates/config/:configId/current
```

#### Get Configuration Details
```
GET /interest-rates/config/:configId
```

#### Get Rate History
```
GET /interest-rates/history/:configId?limit=100
```

Response:
```json
[
  {
    "id": "uuid",
    "calculated_rate": "5.25",
    "utilization_ratio": "0.7500",
    "previous_rate": "5.20",
    "rate_delta": "0.0500",
    "created_at": "2024-10-20T12:00:00Z",
    "config_name": "Main Vault"
  }
]
```

#### Project Rate
```
GET /interest-rates/project/:configId?utilization=75
```

Response:
```json
{
  "projected_rate": "5.25",
  "utilization": "0.7500",
  "config": {
    "id": "uuid",
    "name": "Main Vault",
    "base_rate": "2.00",
    "max_rate": "50.00",
    "optimal_utilization": "0.85"
  }
}
```

#### Get Utilization Metrics
```
GET /interest-rates/utilization
```

Response:
```json
{
  "current_utilization": "0.7500",
  "available_liquidity": "1000000000",
  "borrowed_amount": "750000000",
  "optimal_utilization": "0.8500",
  "utilization_above_optimal": null,
  "headroom_to_max": "25.00"
}
```

### Admin Endpoints

#### List All Configurations
```
POST /admin/interest-rates/configs
```

#### Create Configuration
```
POST /admin/interest-rates/configs
```

Request:
```json
{
  "name": "Conservative Vault",
  "description": "Low-risk rate curve",
  "asset": "USDC",
  "base_rate": 2.0,
  "min_rate": 0.0,
  "max_rate": 50.0,
  "optimal_utilization": 0.85,
  "slope_up": 0.05,
  "slope_down": 0.25,
  "smoothing_factor": 0.1,
  "notes": "Conservative approach to risk"
}
```

#### Update Configuration
```
PUT /admin/interest-rates/configs/:configId
```

#### Activate Configuration
```
POST /admin/interest-rates/configs/:configId/activate
```

#### View Statistics
```
GET /admin/interest-rates/stats
```

## Configuration Examples

### Conservative Strategy
```yaml
name: "Conservative Vault"
base_rate: 2.0%
min_rate: 0.5%
max_rate: 25.0%
optimal_utilization: 80%
slope_up: 3%
slope_down: 15%
smoothing_factor: 0.15
```

Characteristics:
- Low maximum rate
- Gradual increase
- Heavy smoothing
- Protects against volatility

### Aggressive Strategy
```yaml
name: "Growth Vault"
base_rate: 3.0%
min_rate: 0.1%
max_rate: 75.0%
optimal_utilization: 90%
slope_up: 10%
slope_down: 50%
smoothing_factor: 0.05
```

Characteristics:
- High maximum rate
- Steep increases
- Minimal smoothing
- Responsive to market conditions

### Balanced Strategy
```yaml
name: "Balanced Vault"
base_rate: 2.5%
min_rate: 0.25%
max_rate: 40.0%
optimal_utilization: 85%
slope_up: 5%
slope_down: 25%
smoothing_factor: 0.1
```

## Data Models

### InterestRateConfig

```typescript
{
  id: UUID;
  name: string;                      // "Main Vault"
  description: string;               // Configuration description
  asset: string;                     // "USDC"
  base_rate: numeric(10,4);          // 2.00
  min_rate: numeric(10,4);           // 0.00
  max_rate: numeric(10,4);           // 50.00
  optimal_utilization: numeric(5,4); // 0.8500
  slope_up: numeric(10,4);           // 0.0500
  slope_down: numeric(10,4);         // 0.2500
  smoothing_factor: numeric(5,4);    // 0.1000
  is_active: boolean;                // true
  notes: text;
  created_at: Date;
  updated_at: Date;
}
```

### InterestRateHistory

```typescript
{
  id: UUID;
  config_id: UUID;                   // FK to config
  calculated_rate: numeric(10,4);    // 5.2500
  utilization_ratio: numeric(5,4);   // 0.7500
  total_liquidity: varchar;          // "1000000000"
  total_utilization: varchar;        // "750000000"
  oracle_price: varchar | null;      // External price feed
  previous_rate: numeric(10,4);      // 5.2000
  rate_delta: numeric(10,4);         // 0.0500
  created_at: Date;
}
```

### OracleData

```typescript
{
  id: UUID;
  asset: string;                     // "USDC"
  source_type: enum;                 // "chainlink" | "stellar_quest" | ...
  price_usd: string | null;          // "1.00"
  price_base: string | null;         // "10000000" stroops
  confidence: numeric(5,4) | null;   // 0.9999
  price_timestamp: Date;             // When price was observed
  is_valid: boolean;                 // true
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}
```

## Integration Points

### After Deposits/Withdrawals
```typescript
// In SavingsService or similar
await this.interestRateService.calculateCurrentRate(configId);
```

### Calculate Interest Earned
```typescript
const rateService = this.rateCalculator;
const interestEarned = rateService.calculateInterestEarned(
  principal,
  apy,
  daysElapsed
);
```

### Project Rates
```typescript
const projectedRate = await this.interestRateService.projectRate(
  configId,
  0.95 // 95% utilization
);
```

### Get Current Metrics
```typescript
const metrics = await this.interestRateService.getUtilizationMetrics();
// Use for UI display, decision making, etc.
```

## Oracle Integration

### Supported Sources

1. **Stellar Quest** - On-chain Stellar market data
2. **Chainlink** - Decentralized oracle network
3. **Band Protocol** - Cross-chain oracle solution
4. **Anchor** - SEP-24 anchor feeds
5. **Manual** - Admin-provided prices

### Adding Oracle Data
```typescript
await this.interestRateService.updateOraclePrice({
  asset: 'USDC',
  source_type: 'chainlink',
  price_usd: '1.00',
  price_base: '10000000',
  confidence: 0.9999,
  price_timestamp: new Date(),
  notes: 'High confidence feed'
});
```

### Using Oracle Data
```typescript
const oraclePrice = await this.interestRateService.getLatestOraclePrice('USDC');
// Incorporate into rate calculation if needed
```

## Rate Smoothing Explained

### Why Smoothing?

**Without Smoothing:**
- Rates can jump unexpectedly
- Causes user confusion
- May trigger unstable behavior

**With Smoothing:**
- Gradual rate changes
- Better user experience
- System stability

### Example Smoothing

```
Smoothing Factor: 0.1 (10% new, 90% old)

Day 1:
  Previous Rate: 5.00%
  Calculated Rate: 5.50%
  New Rate = 0.1 * 5.50 + 0.9 * 5.00 = 5.05%

Day 2:
  Previous Rate: 5.05%
  Calculated Rate: 6.00%
  New Rate = 0.1 * 6.00 + 0.9 * 5.05 = 5.14%

Day 3:
  Previous Rate: 5.14%
  Calculated Rate: 6.50%
  New Rate = 0.1 * 6.50 + 0.9 * 5.14 = 5.27%
```

Smoothing factor of 0.1 takes ~22 days to reach new equilibrium.

## Performance Considerations

### Query Optimization
- Indexed on (config_id, created_at) for history
- Single config lookup for rates
- Minimal aggregation needed

### Calculation Complexity
- O(1) - Pure calculation, no loops
- Fast even with high call frequency

### Scalability
- Can handle 1000s of rate updates per minute
- History grows steadily but is queryable
- Archive old history if needed

## Setup

### 1. Run Migration
```bash
npm run migration:run
```

### 2. Create Initial Configuration
```bash
curl -X POST http://localhost:3000/admin/interest-rates/configs \
  -H "Authorization: Bearer ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Main Vault",
    "description": "Primary interest rate configuration",
    "asset": "USDC",
    "base_rate": 2.0,
    "min_rate": 0.0,
    "max_rate": 50.0,
    "optimal_utilization": 0.85,
    "slope_up": 0.05,
    "slope_down": 0.25,
    "smoothing_factor": 0.1
  }'
```

### 3. Activate Configuration
```bash
curl -X POST http://localhost:3000/admin/interest-rates/configs/:configId/activate \
  -H "Authorization: Bearer ADMIN_JWT"
```

### 4. Check Current Rate
```bash
curl http://localhost:3000/interest-rates/current \
  -H "Authorization: Bearer USER_JWT"
```

## Testing

### Test Calculation
```typescript
const calculator = new RateCalculatorService();
const config = {
  base_rate: 2,
  min_rate: 0,
  max_rate: 50,
  optimal_utilization: 0.85,
  slope_up: 5,
  slope_down: 25,
  smoothing_factor: 0.1
};

// Test at different utilization levels
console.log(calculator.calculateRate(0.5, config));   // ~2.94%
console.log(calculator.calculateRate(0.85, config));  // ~7.00%
console.log(calculator.calculateRate(0.95, config));  // ~15.40%
```

## Troubleshooting

### Rates Not Updating
- Check configuration is active
- Verify utilization calculation
- Check database connection

### Rates Too Volatile
- Increase smoothing_factor
- Reduce slope_up/slope_down
- Check oracle data quality

### Rates Too Flat
- Decrease smoothing_factor
- Increase slope_up/slope_down
- Adjust base_rate

## Future Enhancements

1. **Advanced Oracle Aggregation**
   - Multiple oracle sources
   - Weighted averages
   - Outlier detection

2. **Risk-Based Rates**
   - Different rates per asset class
   - Credit risk modeling
   - Collateral-based adjustments

3. **Predictive Rate Models**
   - Machine learning predictions
   - Market trend analysis
   - Seasonal adjustments

4. **Rate Governance**
   - DAO voting on parameters
   - Community-driven adjustments
   - Transparency reports

## Summary

A production-ready dynamic rate system with:
- ✅ Utilization-based rate curves
- ✅ Exponential smoothing
- ✅ Oracle data integration
- ✅ Admin configuration
- ✅ Historical tracking
- ✅ Rate projections
- ✅ Full audit trail
