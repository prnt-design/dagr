import { DagrChart, layoutChart } from '@prnt/dagr-chart';
import type { ChartData, DagrChartProps } from '@prnt/dagr-chart';

const data: ChartData = {
  categories: ['A', 'B'],
  series: [{ id: 'orders', label: 'Orders', color: 0x6366f1, values: [3, 7] }],
};
const props: DagrChartProps = { ...data, label: 'Orders', rendering: 'svg', animate: false };
void layoutChart(data, { width: 640, height: 360 });
export const chart = <DagrChart {...props} />;
