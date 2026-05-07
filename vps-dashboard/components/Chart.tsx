'use client';

import { useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  BarController,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  type ChartConfiguration,
} from 'chart.js';

// BarController WAJIB di-register supaya `type: 'bar'` dikenali.
// Tanpa ini: Error "bar" is not a registered controller.
ChartJS.register(BarController, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface ChartProps {
  good:    number;
  notGood: number;
}

/**
 * Bar chart distribusi GOOD vs NOT GOOD. Mirror local web Phase 1.
 */
export function DistributionChart({ good, notGood }: ChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Destroy previous instance pada re-render (avoid leak)
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const config: ChartConfiguration = {
      type: 'bar',
      data: {
        labels: ['GOOD ✅', 'NOT GOOD ❌'],
        datasets: [{
          label: 'Jumlah',
          data: [good, notGood],
          backgroundColor: ['rgba(16,185,129,0.25)', 'rgba(239,68,68,0.25)'],
          borderColor:     ['rgba(16,185,129,0.9)',  'rgba(239,68,68,0.9)'],
          borderWidth: 2,
          borderRadius: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a2235',
            borderColor: '#1e3a5f',
            borderWidth: 1,
            titleColor: '#f1f5f9',
            bodyColor:  '#94a3b8',
            padding: 10,
            callbacks: {
              label: (ctx) => ` ${ctx.parsed.y} inspeksi`,
            },
          },
        },
        scales: {
          x: {
            grid:  { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#94a3b8', font: { family: 'Inter', size: 12 } },
          },
          y: {
            beginAtZero: true,
            grid:  { color: 'rgba(255,255,255,0.05)' },
            ticks: {
              color: '#94a3b8',
              font: { family: 'Inter', size: 11 },
              stepSize: 1,
              precision: 0,
            },
          },
        },
        animation: { duration: 400 },
      },
    };

    chartRef.current = new ChartJS(canvasRef.current, config);

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [good, notGood]);

  return (
    <div className="bg-bg-card border border-border rounded-lg p-5 mb-5">
      <h2 className="text-xs uppercase tracking-wider text-text-muted mb-3 font-semibold flex items-center gap-1.5">
        <span>📉</span> Distribusi Hasil Inspeksi
      </h2>
      <div className="h-64">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
