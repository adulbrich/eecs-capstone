# The task-count alarm sits below what a deploy keeps running

`eecs-capstone-fleet-below-floor` in `infra/alarms.tf` alarms when `RunningTaskCount` is
below `ceil(app_min_tasks * deployment_minimum_healthy_percent / 100)` for three consecutive
one-minute periods: below two tasks while the floor is three.
[ADR-0044](./0044-the-task-count-alarm-is-left-where-a-deploy-may-trip-it.md) left it at the
floor itself to measure what a deploy does to it, and the measurement came in: from
2026-09-22 to 2026-09-29, 12 deploys produced 13 ALARM transitions and nothing else produced
any. Each deploy held the fleet at two of three for 7 to 10 minutes with samples flickering
between two and three, so the two numbers ADR-0044 named, `evaluation_periods` and
`datapoints_to_alarm`, cannot separate a deploy from one task genuinely down: any count long
enough to sit out a deploy also sits out ten minutes of a real loss. The threshold is the
dip itself instead. A deploy under ADR-0043 stops tasks down to the minimum healthy percent
of the desired count, which ECS rounds up, so with 50% it keeps two of three and two of
four, and the alarm reads that percentage from `aws_ecs_service.app` so the two move
together. One below the floor, which #727 proposed, is the same number at a floor of three
but mails on every deploy at four. Two of three tasks crash-looping, the failure shape
ADR-0044 kept the alarm for and the reason it rejected alarming on zero, reads one and fires
if it holds for three samples. That is sure only for a task that exits as it starts: one
that hangs stays RUNNING through about 90 s of failed health checks and its drain, so two
hanging out of phase can keep the samples at two, the same flicker that rules out a longer
count, and nobody has watched one. What this gives up is the fleet short of its desired
count by as many tasks as a deploy stops, one of three today and two of four when scaled
out, which nothing mails about any more. That case has three other answers: ECS replaces a
stopped task within minutes, the deployment circuit breaker rolls back an image that cannot
start, and the two 5XX alarms mail if the remaining tasks stop coping. At a floor of one the
threshold is one, which alarms on a total outage; a deploy of one task under ADR-0043's
percentages can neither stop nor start a task, so it stalls rather than mails. The threshold
holds only while the healthy percent is above 0: at 0 a deploy may stop every task, a `max`
keeps the threshold at one, and the alarm would mail on deploys again. `treat_missing_data`
stays `breaching`, because a service at zero tasks publishes nothing. DEPLOYMENT.md section
8 no longer warns that a deploy mails. Decided 2026-09-30 in #727.
