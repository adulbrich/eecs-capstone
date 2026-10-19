# Term start sizing reviewed, 2026-10-19

The review [#527](https://github.com/adulbrich/eecs-capstone/issues/527) scheduled for
late October: the sizing #522 chose for term start, against what production did from
2026-09-22 to 2026-10-18. Read from CloudWatch (daily, five-minute and one-minute data),
the ALB access logs and Cost Explorer.
[`2026-09-25-term-start-observed.md`](./2026-09-25-term-start-observed.md) covers the
peak week in detail; this picks up from there and adds cost.

**Nothing was undersized, and after the first week most of it was unused.** Traffic fell
about a hundredfold: 308,195 requests on 09-25, 1,659 on 10-18, and no five-minute window
above 200 requests since 10-09. The off-season sizing that follows is
[ADR-0064](../adr/0064-the-fleet-is-sized-per-season.md);
[#793](https://github.com/adulbrich/eecs-capstone/issues/793) restores the term values
before fall 2027.

## Against what #522 assumed

| Metric | #522 assumed | Observed |
| --- | --- | --- |
| ECS `CPUUtilization` | peak 23.9% at one task | 41% busiest task at the 09-25 peak (49 requests per second); target tracking never fired after 09-23 |
| ECS `MemoryUtilization` | 44.7% of 512 MB | 30.4% of 1024 MB at most (09-27); 10% to 17% since 10-03 |
| ECS task count | floor 2, ceiling 4 | 3 every day from 09-24; 4 only during the 09-23 k6 run |
| RDS `DatabaseConnections` | 210 worst case of 220 | 41 at most (09-24, 09-25); 17 to 18 at rest |
| RDS `CPUUtilization`, `CPUCreditBalance` | 6.6%, credits flat | 7.1% at most outside one five-minute bucket; credits at 576 every day |
| ALB `TargetResponseTime` p99, busiest minute | 208 ms, 263 requests | 223 ms worst hour; 2,934 requests; no ELB 5XX |

`PoolWaiting` was 0 in every minute from 09-24 to 10-18.

## After the peak

| Days | Requests a day | Busiest five minutes | p99, worst hour | Busiest task CPU | Memory max | DB connections max |
| --- | --- | --- | --- | --- | --- | --- |
| 09-29 to 10-02 | 25,000 to 45,000 | 710 | 98 ms | 27% | 15% | 39 |
| 10-03 to 10-09 | 6,300 to 12,300 | 617 | 166 ms | 72% | 17% | 18 |
| 10-10 to 10-18 | 1,700 to 9,900 | 190 | 110 ms | 24% | 17% | 35 |

Two outliers, neither with an error or a slow response around it:

- **RDS CPU 54%** in the five minutes from 2026-10-06 04:15 PDT. No deploy, no app log
  beyond the stale-tab bell 500s of that week; one bucket, credits never moved.
- **ECS CPU 72%** on one task in the minute of 2026-10-08 09:15 PDT. The app logged only
  its pool metrics.

Target 5XX from 09-30 to 10-07, 1,906 to 21,580 a day, were tabs loaded before #729
polling the removed bell functions; #775 stubbed them on 10-07.

## A staff page opens more connections than the student peak

`PoolTotal`, the most connections any one task held, reached 26 to 30 in 38 half-hours on
eleven days from 09-23 to 10-12, mostly in staff working hours, while the student burst of
09-25 at 10:48 PDT took it from 5 to 8. The one minute traced, 2026-10-12 at 10:22 PDT, is
a staff session loading `/admin/analytics`: several server functions at once, among them
`getAnalytics`, whose thirteen-query `Promise.all` in `src/server/_internal/analytics.ts`
took 1.9 s at the origin over a month of data. That fan-out, not student concurrency, is
what sizes the off-season pool, and why ADR-0064 keeps a pool of 40 on two tasks rather
than 25 on three.

## Cost

October 1 to 18 cost $56.42, about $97 a month:

| Item | ~$/mo |
| --- | --- |
| Fargate, 3 tasks (vCPU and memory) | 26 |
| RDS `db.t4g.small` | 24 |
| ALB | 17 |
| CloudWatch metrics, almost all Container Insights | 11 |
| Public IPv4, one per task | 11 |
| RDS storage, Secrets Manager, GuardDuty, alarms and the rest | 8 |

ADR-0064 takes off a task and its address (about $12), Container Insights (about $11) and
half the instance (about $12), for about $62 a month off season. The ALB and the task
addresses stay: a NAT gateway to drop the addresses costs more than they do.
