import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "#/components/ui/chart";

/**
 * Page views and visits per day on `/admin/traffic`, the one chart in the
 * app (ADR-0049). The SVG is hidden from assistive technology and the same
 * numbers render as a table beside it that only a screen reader reaches, so
 * nothing the chart says is visual only.
 */

const CONFIG = {
  views: { color: "var(--chart-1)", label: "Page views" },
  visits: { color: "var(--chart-3)", label: "Visits" },
} satisfies ChartConfig;

const DAY = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** `2026-09-22` as `Sep 22`, read as a calendar day rather than an instant. */
function dayLabel(day: string): string {
  return DAY.format(new Date(`${day}T00:00:00Z`));
}

export function TrafficChart({
  daily,
}: {
  daily: { day: string; views: number; visits: number }[];
}) {
  return (
    <>
      <div aria-hidden="true">
        <ChartContainer className="aspect-auto h-64 w-full" config={CONFIG}>
          <LineChart data={daily} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="day"
              minTickGap={24}
              tickFormatter={dayLabel}
              tickLine={false}
              tickMargin={8}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => dayLabel(String(label))}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Line
              dataKey="views"
              dot={false}
              stroke="var(--color-views)"
              strokeWidth={2}
              type="monotone"
            />
            <Line
              dataKey="visits"
              dot={false}
              stroke="var(--color-visits)"
              strokeWidth={2}
              type="monotone"
            />
          </LineChart>
        </ChartContainer>
      </div>
      <table className="sr-only">
        <caption>Page views and visits per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Page views</th>
            <th scope="col">Visits</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((row) => (
            <tr key={row.day}>
              <th scope="row">{dayLabel(row.day)}</th>
              <td>{row.views}</td>
              <td>{row.visits}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
