import { DagrChart } from '@prnt/dagr-chart';
import type { ChartSeries } from '@prnt/dagr-chart';
import '@prnt/dagr-chart/styles.css';

// Illustrative figures, not data about a particular business.
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const series: readonly ChartSeries[] = [
  { id: 'orders', label: 'Orders', color: 0x4f6d8f, values: [17, 32, 38, 35, 41, 46] },
  {
    id: 'total',
    label: 'Running total',
    color: 0xffd166,
    values: [17, 49, 87, 122, 163, 209],
    mark: 'line',
    axis: 'right',
  },
];

const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

export function OrdersChart() {
  return (
    <figure>
      <div style={{ height: 360 }}>
        <DagrChart
          label="Orders by month (bars, left axis) and running total (line, right axis)"
          categories={months}
          series={series}
          formatValue={(value) => whole.format(value)}
          cssColors={{ series: { orders: '--chart-orders', total: '--chart-total' } }}
        />
      </div>
      <figcaption>
        {series.map(({ id, label, color, mark, axis }) => (
          <span key={id} style={{ marginInlineEnd: 16 }}>
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 12,
                height: mark === 'line' ? 2 : 12,
                marginInlineEnd: 6,
                verticalAlign: 'middle',
                background: `var(--chart-${id}, #${color.toString(16).padStart(6, '0')})`,
              }}
            />
            {label} ({axis === 'right' ? 'right' : 'left'} axis)
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
