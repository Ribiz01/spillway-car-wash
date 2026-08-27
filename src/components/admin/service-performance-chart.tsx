"use client";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart as RechartsBarChart, XAxis, YAxis, CartesianGrid } from "recharts";

interface ServicePerformanceChartProps {
  data: { name: string; count: number }[];
}

const chartConfig = {
  count: {
    label: "Washes",
    color: "hsl(var(--primary))",
  },
} satisfies ChartConfig;

export function ServicePerformanceChart({ data }: ServicePerformanceChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-muted-foreground">
        No data for this period.
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="min-h-[200px] w-full">
      <RechartsBarChart accessibilityLayer data={data}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="name" tickLine={false} tickMargin={10} axisLine={false} />
        <YAxis />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} />
      </RechartsBarChart>
    </ChartContainer>
  );
}
