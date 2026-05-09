import { BarChart3, LineChart, TrendingUp } from 'lucide-react';

interface DataPoint {
    label: string;
    value: number;
}

interface ChartCardProps {
    title: string;
    type: 'line' | 'bar';
    data: DataPoint[];
    color?: string;
    onAction?: (action: string, data: any) => void;
}

const ChartCard = (props: ChartCardProps) => {
    const { title, type = 'line', data, color = '#3b82f6' } = props;

    if (!data || data.length === 0) return null;

    const values = data.map(d => d.value);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min;
    const padding = 40;
    const width = 300;
    const height = 150;

    // Normalize coordinates
    const points = data.map((d, i) => ({
        x: (i / (data.length - 1)) * (width - padding * 2) + padding,
        y: height - padding - ((d.value - min) / (range || 1)) * (height - padding * 2)
    }));

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                background: 'rgba(25, 25, 30, 0.4)',
                backdropFilter: 'blur(10px)',
                borderRadius: '20px',
                border: '1px solid rgba(255,255,255,0.08)',
                overflow: 'hidden',
                color: '#fff'
            }}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
        >
            <div style={{ padding: '20px', paddingBottom: '0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    {type === 'line' ? <LineChart size={16} color={color} /> : <BarChart3 size={16} color={color} />}
                    <div style={{ fontSize: '0.9rem', fontWeight: '800' }}>{title}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: '900' }}>{data[data.length - 1].value.toLocaleString()}</div>
                    <div style={{ fontSize: '0.7rem', color: '#10b981', display: 'flex', alignItems: 'center', fontWeight: '700' }}>
                        <TrendingUp size={12} /> +2.4%
                    </div>
                </div>
            </div>

            {/* SVG Chart Area */}
            <div style={{ width: '100%', height: '180px', position: 'relative' }}>
                <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
                    <defs>
                        <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
                            <stop offset="100%" stopColor={color} stopOpacity="0" />
                        </linearGradient>
                    </defs>

                    {type === 'line' && (
                        <>
                            <path d={areaPath} fill="url(#gradient)" />
                            <path d={linePath} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                            {points.map((p, i) => (
                                <circle key={i} cx={p.x} cy={p.y} r="3" fill="#fff" stroke={color} strokeWidth="1.5" />
                            ))}
                        </>
                    )}

                    {type === 'bar' && data.map((d, i) => {
                        const barWidth = (width - padding * 2) / (data.length * 1.5);
                        const x = (i / (data.length)) * (width - padding * 2) + padding;
                        const barHeight = ((d.value - min) / (range || 1)) * (height - padding * 2) + 10;
                        return (
                            <rect
                                key={i}
                                x={x}
                                y={height - padding - barHeight}
                                width={barWidth}
                                height={barHeight}
                                fill={color}
                                rx="4"
                                style={{ opacity: 0.8 }}
                            />
                        );
                    })}

                    {/* X-Axis Labels */}
                    {data.filter((_, i) => i % Math.ceil(data.length / 4) === 0).map((d, i) => (
                        <text
                            key={i}
                            x={(data.indexOf(d) / (data.length - 1)) * (width - padding * 2) + padding}
                            y={height - 20}
                            textAnchor="middle"
                            fontSize="8"
                            fill="rgba(255,255,255,0.3)"
                            fontWeight="700"
                        >
                            {d.label}
                        </text>
                    ))}
                </svg>
            </div>
        </div>
    );
};

export default ChartCard;
