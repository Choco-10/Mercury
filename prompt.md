# Build: Amazon Seller Intelligence

You are a senior full-stack engineer, AWS solutions architect, ML engineer, and GenAI engineer.

Build a polished hackathon-ready web application called **Amazon Seller Intelligence**.

The project is for an AWS hackathon. The goal is to demonstrate practical **AWS architecture, Generative AI, multi-agent systems, machine learning, event-driven architecture, and system-design thinking** without over-engineering the MVP.

---

# 1. Product Overview

Amazon Seller Intelligence is a decision-support platform for Amazon sellers whose products operate in competitive categories.

The product helps a seller understand:

* how their product is performing
* how competitors are positioned
* whether demand is increasing or decreasing
* what demand may look like over the next 14 days
* how different prices could affect estimated demand and revenue
* what business signals deserve attention
* why the system is making a particular recommendation

The primary user question is:

> **"What should I consider doing with this product right now, and what evidence supports that?"**

Pricing should be the flagship decision-support feature.

The application must NOT automatically change prices or perform transactions on behalf of sellers.

It should provide recommendations and simulations for the seller to make the final decision.

---

# 2. MVP Scope

Build the MVP around:

## Seller

One demo seller.

## Products

Five products.

Each product belongs to a competitive category and has approximately five competitors.

## Primary features

1. Product dashboard
2. Sales and demand analytics
3. 14-day demand forecast
4. Competitor intelligence
5. Pricing what-if simulator
6. AI-generated business insights
7. Conversational AI Analyst

## AWS architecture features

1. Serverless API
2. Object storage
3. Application database
4. Generative AI
5. ML forecasting
6. Multi-agent reasoning
7. Scheduled/event-driven analysis
8. Workflow orchestration

Do NOT build authentication initially.

Do NOT depend on live Amazon scraping.

Do NOT build automatic price changes.

Do NOT build mobile applications.

Do NOT build dozens of microservices.

Do NOT add unnecessary AWS services simply to increase the service count.

---

# 3. Data Strategy

The application must support both:

### A. Preloaded demo data

Use realistic synthetic data so the application works immediately after deployment.

### B. CSV upload

Allow the seller to upload compatible sales and competitor datasets.

The demo must never depend on an external marketplace endpoint being available.

The data model should be designed so that a future Amazon Selling Partner API integration could replace the demo ingestion layer without rewriting the analysis system.

Clearly separate:

```text
Data ingestion
Data normalization
Analysis
ML forecasting
AI reasoning
Presentation
```

---

# 4. Example Product

Create realistic demo data for products such as:

* Wireless Earbuds
* Smart Watch
* Laptop Stand
* USB-C Hub
* Portable Bluetooth Speaker

Use realistic but synthetic values.

Each product should have:

* product ID
* product title
* category
* seller price
* seller discount
* seller rating
* historical sales
* historical price
* inventory
* approximately five competitors

Each competitor should contain:

* competitor ID
* product title
* category
* price
* rating
* discount
* observation date

Sales history should contain enough historical observations for trend analysis and forecasting.

Include realistic patterns such as:

* increasing demand
* decreasing demand
* relatively stable demand
* periodic/seasonal changes
* competitor price changes

Do not make every product behave the same way.

---

# 5. Frontend

Build a polished startup-style analytics dashboard.

Use React/Next.js or the project's most appropriate frontend framework.

Deploy through Amazon Amplify.

The frontend should prioritize usability over visual complexity.

## Main navigation

```text
Dashboard
Products
AI Analyst
Data
Settings
```

Settings can be mostly placeholder functionality for the MVP.

---

# 6. Dashboard

The dashboard should immediately communicate the state of the seller's business.

Include:

### Top-level metrics

* Products monitored
* Products requiring attention
* Average competitor price
* Current seller revenue/sales metric
* Latest analysis timestamp

### Product cards/table

For each product show:

* product name
* category
* current price
* rating
* discount
* demand trend
* forecast indicator
* competitor price position
* attention/recommendation status

The user should be able to click a product to open its detailed analysis.

---

# 7. Product Detail Page

Create a detailed analytics page.

Example:

```text
Wireless Earbuds
Electronics / Wireless Earbuds

₹1,599
Rating: 4.3
Discount: 10%

Demand Trend
[chart]

14-Day Forecast
[chart]

Competitor Landscape
[table]

Pricing Simulator
[interactive section]

AI Insights
[recommendation cards]
```

---

# 8. Demand Analytics

Display historical demand using a chart.

Show:

* historical units sold
* trend
* relevant price changes
* important demand events if available

Do not claim causation unless the data supports it.

Use language such as:

* "demand increased"
* "sales declined"
* "price and demand moved together"
* "the data suggests"
* "forecast indicates"

Avoid unsupported claims such as:

> "The price reduction definitely caused the increase."

---

# 9. 14-Day Forecast

Implement a real forecasting component.

The model should produce:

```text
expected demand
lower bound
upper bound
```

for each of the next 14 days.

Example:

```text
Date        Expected    Lower    Upper
Day 1       18          15       22
Day 2       19          16       23
...
Day 14      24          19       29
```

Visualize:

* historical demand
* forecast
* uncertainty interval

The UI must communicate that forecasts are estimates.

Do not present forecasts as guaranteed future sales.

---

# 10. Machine Learning Architecture

Use a proper ML component for demand forecasting.

Prefer Amazon SageMaker for the AWS implementation.

However, structure the application so that the forecasting implementation is isolated behind a service/function such as:

```text
ForecastService.predict(product_id, horizon=14)
```

This allows a lightweight local/demo implementation during development and SageMaker deployment later without rewriting the frontend.

If SageMaker deployment is practical within the hackathon timeline, use it.

If not, implement a sound baseline forecasting model and clearly isolate it so SageMaker can replace it.

Do NOT use an LLM to predict numerical demand.

---

# 11. Competitor Intelligence

For each product, compare the seller against approximately five competitors.

Display:

* product title
* price
* discount
* rating
* category

Calculate deterministic metrics such as:

* competitor average price
* competitor median price
* minimum price
* maximum price
* seller price position
* price difference percentage

Example:

```text
Seller price:          ₹1,599
Competitor median:     ₹1,549
Difference:            +3.2%
```

These calculations must be performed by application code, not generated by the LLM.

---

# 12. Pricing What-If Simulator

This is the flagship feature.

Allow the seller to test different prices.

Example:

```text
Current price: ₹1,599

Scenario prices:

₹1,499
₹1,549
₹1,599
₹1,649
₹1,699
```

For every scenario calculate/estimate:

* expected demand
* expected revenue
* competitor price position
* percentage change from current price

Display the scenarios visually.

Example:

```text
Price      Expected Demand     Estimated Revenue
₹1,499     135                 ₹202,365
₹1,549     129                 ₹199,821
₹1,599     120                 ₹191,880
₹1,649     111                 ₹182,? 
₹1,699     103                 ₹175,? 
```

The numbers above are illustrative only. Use values generated by the actual implementation.

Do not allow the LLM to invent these calculations.

Create a dedicated deterministic pricing/scenario service.

---

# 13. Recommendation Engine

The application should combine:

* current price
* competitor prices
* discounts
* demand trend
* demand forecast
* rating
* historical behavior
* pricing simulations

The recommendation engine should produce structured output.

Example:

```json
{
  "product_id": "P001",
  "status": "attention",
  "primary_area": "pricing",
  "suggested_action": "test_price",
  "candidate_price": 1549,
  "confidence": "medium",
  "reasons": [
    "seller price is above competitor median",
    "14-day demand forecast is increasing",
    "scenario analysis shows a different revenue/demand trade-off"
  ]
}
```

Do not let the LLM directly create unsupported numerical values.

---

# 14. Multi-Agent Architecture

Implement a small, meaningful multi-agent system.

Do NOT create artificial agents simply to increase the agent count.

Use:

## Supervisor Agent

Responsible for:

* understanding the seller's question
* determining which analyses are required
* calling the appropriate specialist capabilities
* combining structured results
* producing a final explanation

## Market Analyst Agent

Responsible for:

* demand trends
* historical performance
* market/category signals
* seasonality or periodic patterns

## Competitor Analyst Agent

Responsible for:

* competitor pricing
* competitor discounts
* competitor ratings
* competitive positioning

## Pricing Analyst Agent

Responsible for:

* interpreting pricing scenarios
* comparing pricing trade-offs
* using forecast outputs
* preparing pricing-related analysis

## Forecasting Model

This is NOT an LLM agent.

It is a separate ML capability.

---

# 15. Agent Output Must Be Structured

Agents should return structured JSON rather than uncontrolled prose whenever possible.

Example:

```json
{
  "agent": "competitor_analyst",
  "product_id": "P001",
  "findings": [
    {
      "metric": "competitor_median_price",
      "value": 1549
    },
    {
      "metric": "seller_price_difference_percent",
      "value": 3.2
    }
  ],
  "summary": "Seller price is above competitor median."
}
```

The supervisor should reason over these structured outputs.

---

# 16. AI Analyst

Implement this AFTER the dashboard and core analytics work.

The AI Analyst should be conversational.

Example questions:

> Why is my product becoming less competitive?

> Should I investigate changing my price?

> What are my main competitive risks?

> What changed recently?

> Explain the 14-day forecast.

> What happens if I reduce my price?

The AI Analyst must use the seller's actual product data and analysis results.

It should not answer using generic e-commerce knowledge when product-specific information is available.

---

# 17. Grounding and Hallucination Control

This is a critical requirement.

The LLM is NOT the source of truth for:

* prices
* revenue
* demand
* forecasts
* competitor statistics
* percentage calculations

Those values come from:

```text
Database
+
Deterministic calculations
+
ML model
```

Bedrock is responsible for:

* interpretation
* reasoning
* synthesis
* explanation
* conversational interaction

If data is unavailable, the AI should explicitly say that it does not have sufficient data rather than inventing an answer.

---

# 18. AWS Architecture

Use this architecture:

```text
                     Amazon Amplify
                           │
                           ▼
                    React Web App
                           │
                           ▼
                     API Gateway
                           │
                           ▼
                        Lambda
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
         DynamoDB          S3         Bedrock
             │             │             │
             │             │        Agent System
             │             │             │
             │             │      ┌──────┼──────┐
             │             │      ▼      ▼      ▼
             │             │    Market Competitor Pricing
             │             │    Agent    Agent    Agent
             │             │
             │             ▼
             │       Data / datasets
             │
             ▼
       Analysis results

                      SageMaker
                          │
                          ▼
                  Demand Forecast
```

For scheduled processing:

```text
EventBridge
     │
     ▼
Step Functions
     │
     ├── Load latest data
     ├── Validate data
     ├── Run market analysis
     ├── Run competitor analysis
     ├── Run demand forecast
     ├── Run pricing analysis
     ├── Generate AI insights
     └── Store results
```

---

# 19. S3 Design

Use S3 for files and datasets.

Suggested structure:

```text
seller-intelligence/
├── raw/
│   ├── sales/
│   └── competitors/
├── processed/
│   ├── sales/
│   └── competitors/
├── models/
└── exports/
```

Do not store large raw datasets directly in DynamoDB.

---

# 20. DynamoDB Design

Use DynamoDB for application state and frequently accessed structured data.

Possible entities:

```text
Seller
Product
Competitor
SalesRecord
Forecast
AnalysisRun
Recommendation
```

Design keys carefully.

Example:

```text
PK: SELLER#001
SK: PRODUCT#P001
```

and related entities underneath the product.

Use appropriate indexes where needed.

Avoid over-normalizing the database.

---

# 21. Data Upload Flow

Implement:

```text
User
 ↓
Frontend
 ↓
API Gateway
 ↓
Lambda
 ↓
S3
 ↓
Validation / normalization
 ↓
DynamoDB
 ↓
Analysis
```

Validate uploaded CSV files.

Handle:

* missing columns
* invalid dates
* invalid numeric values
* duplicate records
* unknown product IDs

Return useful errors to the frontend.

---

# 22. Event-Driven Processing

Implement a scheduled analysis workflow.

Example:

```text
EventBridge
     ↓
Daily trigger
     ↓
Step Functions
     ↓
Load product data
     ↓
Parallel analysis
     ├── Market
     ├── Competitors
     └── Forecast
             ↓
       Pricing Analysis
             ↓
        Bedrock synthesis
             ↓
          DynamoDB
```

Where possible, independent analyses should execute in parallel.

Use retries for transient failures.

Do not allow one failed optional analysis to destroy the entire workflow if the remaining analysis can still be presented.

---

# 23. Failure Handling

The system should demonstrate production-oriented thinking.

Handle:

### Forecasting failure

Show:

> Forecast temporarily unavailable.

But still display competitor and historical analysis.

### Bedrock failure

Show existing numerical analysis and a graceful message.

### Invalid CSV

Return validation errors.

### Duplicate scheduled execution

Use idempotency keys such as:

```text
product_id + analysis_date
```

so retries do not create duplicate analysis records.

### Partial workflow failure

Use Step Functions retry/catch logic.

---

# 24. API Design

Create clean API boundaries.

Examples:

```text
GET    /api/products
GET    /api/products/{id}
GET    /api/products/{id}/competitors
GET    /api/products/{id}/forecast
GET    /api/products/{id}/analysis
POST   /api/products/{id}/simulate-price
POST   /api/products/{id}/analyze
POST   /api/ai/chat
POST   /api/data/upload
```

Keep business logic out of the frontend.

---

# 25. Security

Even though authentication is deferred:

* never expose AWS credentials in frontend code
* use IAM roles
* use environment variables/secrets appropriately
* validate API input
* validate uploaded files
* apply least-privilege permissions
* do not expose raw internal AWS errors to users

Design the application so Cognito can be added later.

---

# 26. UI Requirements

The UI should look like a real analytics SaaS product.

Prioritize:

* clean typography
* clear hierarchy
* responsive layout
* useful charts
* readable tables
* meaningful empty/loading/error states
* consistent cards
* restrained use of color
* clear labels

Do not create unnecessary animations.

Do not sacrifice functionality for visual effects.

---

# 27. Important UI States

Implement:

### Loading

Show skeletons or meaningful loading indicators.

### Empty state

Explain what the seller needs to upload/select.

### Error state

Explain the problem and possible next action.

### Forecast unavailable

Do not break the entire dashboard.

### AI processing

Show the analysis stages, for example:

```text
✓ Market analysis
✓ Competitor analysis
⟳ Demand forecast
○ Pricing analysis
○ AI synthesis
```

This also makes the multi-agent architecture visible during the hackathon demo.

---

# 28. Demo Mode

The application must work immediately using the preloaded synthetic dataset.

Provide a clear:

> **Load Demo Data**

or equivalent mechanism.

The judges should not need to configure external APIs.

The demo should contain enough variation that the recommendation system produces interesting results.

---

# 29. Recommended Demo Story

The primary demo should take approximately 3–5 minutes.

### Step 1

Open dashboard.

Show:

```text
5 products monitored
2 products require attention
```

### Step 2

Open Wireless Earbuds.

Show:

* current price
* sales history
* competitors
* demand forecast

### Step 3

Open competitor analysis.

Show approximately five competitors.

### Step 4

Open pricing simulator.

Compare several price points.

### Step 5

Run analysis.

Show the specialist analysis stages.

### Step 6

Display AI-generated explanation grounded in the calculated results.

### Step 7

Open AI Analyst.

Ask:

> "Why should I investigate my current pricing?"

The response should reference actual dashboard data.

### Step 8

Explain the architecture.

Show:

```text
Amplify
  ↓
API Gateway
  ↓
Lambda
  ↓
DynamoDB / S3
  ↓
Step Functions
  ↓
Bedrock + Forecasting
```

Then explain the event-driven scheduled workflow.

---

# 30. System Design Explanation

The final application should make these architectural principles demonstrable:

## Serverless

The API and application logic use Lambda.

## Event-driven

EventBridge triggers scheduled analysis.

## Workflow orchestration

Step Functions coordinates multiple analysis stages.

## Separation of concerns

Different components handle:

* storage
* calculations
* forecasting
* GenAI
* orchestration
* presentation

## ML + GenAI

ML predicts numerical outcomes.

GenAI interprets and explains them.

## Fault tolerance

Partial failures should not destroy the entire dashboard.

## Scalability

The architecture should be capable of expanding from:

```text
1 seller
5 products
```

to:

```text
many sellers
thousands of products
```

without fundamentally changing the architecture.

---

# 31. Do Not Over-Engineer

This is extremely important.

Do NOT introduce:

* Kubernetes
* unnecessary microservices
* Kafka unless genuinely necessary
* complex vector databases
* graph databases
* custom LLM training
* fine-tuning unless there is a clear demonstrated need
* 10+ agents
* real-time streaming unless necessary
* unnecessary infrastructure

The goal is a working, explainable, scalable AWS architecture.

---

# 32. Future Architecture

Document these as future extensions but do not make them MVP dependencies:

### Amazon integration

Replace CSV ingestion with an approved Amazon data/API integration.

### Cognito

Seller authentication.

### More products

Scale from five products to large catalogs.

### Historical personalization

Learn seller-specific pricing behavior.

### Additional forecasting

Inventory forecasting and replenishment recommendations.

### More intelligence

Promotion optimization, listing analysis, review analysis, and seasonal planning.

### Notifications

Send important seller alerts through appropriate AWS services.

---

# 33. Code Quality

Use:

* clear project structure
* reusable components
* typed interfaces/types
* environment configuration
* centralized error handling
* service abstraction for AWS integrations
* clean separation between UI, API, business logic, ML, and AI

Avoid giant files.

Avoid hardcoded business logic scattered throughout components.

Use mock/demo services only behind clear interfaces so they can be replaced by AWS implementations.

---

# 34. Implementation Order

Build in this order.

## Phase 1 — Frontend foundation

Build:

* application shell
* navigation
* dashboard
* product list
* product detail page
* charts
* competitor table
* pricing simulator UI

Use demo data initially.

## Phase 2 — Backend

Implement:

* API Gateway
* Lambda
* DynamoDB
* S3
* data models
* product APIs
* analysis APIs

## Phase 3 — Forecasting

Implement:

* forecasting service
* 14-day prediction
* uncertainty interval
* forecast API
* forecast visualization

## Phase 4 — Competitor and pricing analysis

Implement deterministic:

* competitor metrics
* pricing scenarios
* estimated demand/revenue calculations
* recommendation inputs

## Phase 5 — Bedrock

Implement:

* specialist agents
* supervisor
* structured outputs
* grounded AI Analyst

## Phase 6 — Event-driven workflow

Implement:

* EventBridge
* Step Functions
* scheduled analysis
* retries
* partial failure handling
* idempotency

## Phase 7 — Polish

Improve:

* UX
* loading states
* error states
* responsive layout
* charts
* demo experience

## Phase 8 — Deployment

Deploy through AWS.

Document:

* architecture
* environment variables
* deployment steps
* AWS services
* data flow
* demo instructions

---

# 35. Deliverables

Produce:

1. Working web application
2. AWS architecture
3. Synthetic demo dataset
4. CSV upload functionality
5. Demand forecasting
6. Competitor analysis
7. Pricing simulator
8. Multi-agent Bedrock system
9. Conversational AI Analyst
10. EventBridge + Step Functions workflow
11. DynamoDB schema
12. S3 structure
13. API documentation
14. Architecture diagram
15. README
16. Hackathon demo instructions

---

# 36. README Requirements

The README should explain:

## Problem

What problem Amazon sellers face.

## Solution

What Amazon Seller Intelligence does.

## Architecture

Include an architecture diagram.

## AWS services

Explain why each AWS service exists.

## AI architecture

Explain:

* Supervisor
* Market Analyst
* Competitor Analyst
* Pricing Analyst
* forecasting model

## Data flow

Explain both:

* on-demand analysis
* scheduled analysis

## ML vs GenAI

Explicitly explain why forecasting/calculations are not delegated to the LLM.

## Failure handling

Explain retries, partial failures, and idempotency.

## Local development

Give exact setup instructions.

## Deployment

Give exact AWS deployment instructions.

## Demo

Give a step-by-step demo script.

---

# 37. Critical Product Principle

The final implementation should communicate this idea:

> **Amazon Seller Intelligence does not replace the seller's decision. It gives the seller structured evidence, forecasts, competitive context, pricing scenarios, and AI-assisted reasoning so the seller can make the decision.**

The application is a decision-support system, not an autonomous trading/pricing system.

---

# 38. Final Engineering Constraint

Before implementing any feature, ask:

> Does this materially improve the seller's ability to understand their product and make a pricing/business decision?

If not, do not add it to the MVP.

Prioritize:

```text
Working product
    >
Reliable calculations
    >
Useful ML forecast
    >
Grounded AI
    >
AWS architecture
    >
Visual polish
    >
Extra features
```

Build the smallest complete system that demonstrates all of the above.
