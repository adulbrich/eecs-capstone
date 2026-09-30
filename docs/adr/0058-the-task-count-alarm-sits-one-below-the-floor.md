# The task-count alarm sits one below the floor

`eecs-capstone-fleet-below-floor` in `infra/alarms.tf` alarms when
`RunningTaskCount` is below `var.app_min_tasks - 1` for three consecutive
one-minute periods, below two tasks while the floor is three.
[ADR-0044](./0044-the-task-count-alarm-is-left-where-a-deploy-may-trip-it.md)
left it at the floor itself to measure what a deploy does to it, and the
measurement came in: from 2026-09-22 to 2026-09-29, 12 deploys produced 13
ALARM transitions and nothing else produced any. Each deploy held the fleet at
two of three for 7 to 10 minutes with samples flickering between two and three,
so the two numbers ADR-0044 named, `evaluation_periods` and
`datapoints_to_alarm`, cannot separate a deploy from one task genuinely down:
any count long enough to sit out a deploy also sits out ten minutes of a real
loss. Moving the threshold instead works because of ADR-0043's
`deployment_minimum_healthy_percent` of 50, which ECS rounds up to two of three,
so a deploy never reads below two. Two of three tasks crash-looping, the failure
shape ADR-0044 kept the alarm for and the reason it rejected alarming on zero,
reads one and still fires. What this gives up is one task of three staying down,
which nothing mails about any more. That case has three other answers: ECS
replaces a stopped task within minutes, the deployment circuit breaker rolls
back an image that cannot start, and the two 5XX alarms mail if the remaining
tasks stop coping. The threshold is `max(var.app_min_tasks - 1, 1)`, so a floor
lowered to one still alarms on a total outage. `treat_missing_data` stays
`breaching`, because a service at zero tasks publishes nothing. DEPLOYMENT.md
section 8 no longer warns that a deploy mails. Decided 2026-09-30 in #727.
