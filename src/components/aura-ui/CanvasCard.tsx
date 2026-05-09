import { useEffect, useRef } from 'react';
import ReactECharts from 'echarts-for-react';

interface Node {
    id: string;
    label: string;
    status: 'processing' | 'success' | 'error';
    size?: 'small' | 'medium' | 'large';
}

interface Link {
    source: string;
    target: string;
    label?: string;
}

interface CanvasCardProps {
    nodes: Node[];
    links: Link[];
}

const CanvasCard = ({ nodes, links }: CanvasCardProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const echartsRef = useRef<any>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // 使用 ResizeObserver 监听容器大小变化
        // 解决 ECharts 在模态框等动态布局中初始化时宽度为 0 导致偏向左侧的问题
        const resizeObserver = new ResizeObserver(() => {
            if (echartsRef.current) {
                echartsRef.current.getEchartsInstance().resize();
            }
        });

        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    // Convert status to color
    const getStatusColor = (status: string, alpha: number = 1) => {
        if (status === 'success') return `rgba(16, 185, 129, ${alpha})`;
        if (status === 'processing') return `rgba(59, 130, 246, ${alpha})`;
        if (status === 'error') return `rgba(239, 68, 68, ${alpha})`;
        return `rgba(255, 255, 255, ${alpha})`;
    };

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            show: true,
            trigger: 'item',
            backgroundColor: 'rgba(25, 25, 30, 0.9)',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            textStyle: { color: '#fff', fontSize: 12 },
            formatter: (params: any) => {
                if (params.dataType === 'node') {
                    return `${params.data.nodeLabel} <span style="color: ${getStatusColor(params.data.status)}">(${params.data.status})</span>`;
                }
                return params.data.label || 'Connection';
            }
        },
        animationDurationUpdate: 1500,
        animationEasingUpdate: 'quinticInOut',
        series: [
            {
                type: 'graph',
                layout: 'force',
                force: {
                    repulsion: 300,
                    edgeLength: 80,
                    gravity: 0.2,
                    friction: 0.6
                },
                roam: true, // Allow zoom and pan
                draggable: true,
                emphasis: {
                    focus: 'adjacency',
                    lineStyle: {
                        width: 4,
                        color: 'rgba(255, 255, 255, 0.5)'
                    }
                },
                blur: {
                    itemStyle: {
                        opacity: 0.4
                    },
                    label: {
                        opacity: 0.4
                    },
                    lineStyle: {
                        opacity: 0.2
                    }
                },
                data: nodes.map(node => ({
                    id: node.id,
                    name: node.id, // Used for linking
                    nodeLabel: node.label, // Custom field for display
                    status: node.status,
                    symbolSize: node.size === 'large' ? 45 : node.size === 'medium' ? 30 : 15,
                    itemStyle: {
                        color: getStatusColor(node.status, 0.2),
                        borderColor: getStatusColor(node.status, 1),
                        borderWidth: 2,
                        shadowBlur: 20,
                        shadowColor: getStatusColor(node.status, 0.8)
                    },
                    label: {
                        show: true,
                        position: 'bottom',
                        formatter: node.label, // Use label instead of ID
                        color: '#fff',
                        fontSize: 11,
                        fontWeight: '700',
                        distance: 8
                    }
                })),
                links: links.map(link => ({
                    source: link.source,
                    target: link.target,
                    label: {
                        show: !!link.label,
                        formatter: link.label,
                        color: 'rgba(255,255,255,0.6)',
                        fontSize: 10
                    },
                    lineStyle: {
                        color: 'rgba(255,255,255,0.15)',
                        width: 1.5,
                        curveness: 0.1
                    }
                })),
                lineStyle: {
                    opacity: 0.9,
                    width: 2,
                    curveness: 0
                }
            }
        ]
    };

    return (
        <div
            ref={containerRef}
            className="w-full bg-[#19191e]/40 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden my-4"
            style={{ height: '320px' }}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
        >
            <ReactECharts 
                ref={echartsRef}
                option={option} 
                style={{ height: '100%', width: '100%' }}
            />
        </div>
    );
};

export default CanvasCard;
