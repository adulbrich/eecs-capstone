import {
  type ComponentProps,
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
} from "react";
import {
  type DefaultLegendContentProps,
  Legend,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import { cn } from "#/lib/utils";

/**
 * shadcn's `chart`, added with its CLI (#592) and trimmed to what the app
 * uses: a container, a tooltip and a legend. Two changes from upstream,
 * both for this repo's rules. Series colors reach Recharts as CSS custom
 * properties set on the container's `style`, rather than through a
 * generated `<style>` tag, so there is no `dangerouslySetInnerHTML`; and a
 * color is a token such as `var(--chart-1)`, never a hex code, so dark mode
 * and a rebrand reach the chart the way they reach everything else
 * (docs/UI-CONVENTIONS.md, "Color tokens").
 */

/** One series: its label, and the token it draws in. */
export type ChartConfig = Record<string, { color: string; label: ReactNode }>;

const ChartContext = createContext<ChartConfig | null>(null);

function useChartConfig(): ChartConfig {
  const config = useContext(ChartContext);
  if (!config) {
    throw new Error("A chart part must be rendered inside <ChartContainer>");
  }
  return config;
}

/** Every series' token as `--color-<key>`, which the chart's marks read. */
function colorVariables(config: ChartConfig): CSSProperties {
  return Object.fromEntries(
    Object.entries(config).map(([key, { color }]) => [`--color-${key}`, color])
  ) as CSSProperties;
}

export function ChartContainer({
  children,
  className,
  config,
  style,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  children: ComponentProps<typeof ResponsiveContainer>["children"];
  config: ChartConfig;
}) {
  return (
    <ChartContext.Provider value={config}>
      <div
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-surface]:outline-hidden",
          className
        )}
        data-slot="chart"
        style={{ ...colorVariables(config), ...style }}
        {...props}
      >
        <ResponsiveContainer initialDimension={{ height: 200, width: 320 }}>
          {children}
        </ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = Tooltip;

/** A dot, a label and a value per series, under the hovered point's label. */
export function ChartTooltipContent({
  active,
  label,
  labelFormatter,
  payload,
}: Partial<
  Pick<
    TooltipContentProps<TooltipValueType, string>,
    "active" | "label" | "labelFormatter" | "payload"
  >
>) {
  const config = useChartConfig();
  if (!(active && payload?.length)) {
    return null;
  }
  return (
    <div className="grid min-w-32 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">
        {labelFormatter ? labelFormatter(label, payload) : label}
      </div>
      {payload.map((item) => {
        const key = String(item.dataKey ?? item.name);
        return (
          <div className="flex items-center gap-2" key={key}>
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: item.color }}
            />
            <span className="flex-1 text-muted-foreground">
              {config[key]?.label ?? item.name}
            </span>
            <span className="font-medium font-mono text-foreground tabular-nums">
              {typeof item.value === "number"
                ? item.value.toLocaleString("en-US")
                : String(item.value ?? "")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export const ChartLegend = Legend;

/** One swatch and label per series. */
export function ChartLegendContent({ payload }: DefaultLegendContentProps) {
  const config = useChartConfig();
  if (!payload?.length) {
    return null;
  }
  return (
    <div className="flex items-center justify-center gap-4 pt-3">
      {payload.map((item) => {
        const key = String(item.dataKey ?? item.value);
        return (
          <div className="flex items-center gap-1.5" key={key}>
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: item.color }}
            />
            {config[key]?.label ?? item.value}
          </div>
        );
      })}
    </div>
  );
}
