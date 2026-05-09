import { useEffect, useRef, useState } from 'react';

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

interface PhysicsNode extends Node {
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
}

interface PhysicsLink extends Link {
    sourceNode: PhysicsNode;
    targetNode: PhysicsNode;
}

const CanvasCard = ({ nodes, links }: CanvasCardProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 300 });
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (containerRef.current) {
            setDimensions({
                width: containerRef.current.clientWidth,
                height: 300
            });
        }
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || dimensions.width === 0) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Set display size (css pixels)
        canvas.style.width = `${dimensions.width}px`;
        canvas.style.height = `${dimensions.height}px`;

        // Set actual size in memory (scaled for retina displays)
        const dpr = window.devicePixelRatio || 1;
        canvas.width = dimensions.width * dpr;
        canvas.height = dimensions.height * dpr;

        // Scale all drawing operations by the dpr
        ctx.scale(dpr, dpr);

        // Initialize physics nodes
        const physicsNodes: PhysicsNode[] = nodes.map(node => {
            const sizeMap = { small: 15, medium: 25, large: 35 };
            const radius = sizeMap[node.size || 'medium'];
            return {
                ...node,
                x: Math.random() * dimensions.width,
                y: Math.random() * dimensions.height,
                vx: 0,
                vy: 0,
                radius
            };
        });

        // Initialize physics links
        const physicsLinks: PhysicsLink[] = links.map(link => {
            const sourceNode = physicsNodes.find(n => n.id === link.source)!;
            const targetNode = physicsNodes.find(n => n.id === link.target)!;
            return { ...link, sourceNode, targetNode };
        }).filter(link => link.sourceNode && link.targetNode);

        let animationFrameId: number;
        let alpha = 1.0; // Cooling factor

        const updatePhysics = () => {
            if (alpha < 0.01) return; // Stop simulation when cooled down

            const k = 0.05; // Spring constant
            const length = 100; // Desired link length
            const repulsion = 1000; // Repulsion force

            // 1. Repulsion between all nodes
            for (let i = 0; i < physicsNodes.length; i++) {
                const nodeA = physicsNodes[i];
                for (let j = i + 1; j < physicsNodes.length; j++) {
                    const nodeB = physicsNodes[j];
                    const dx = nodeB.x - nodeA.x;
                    const dy = nodeB.y - nodeA.y;
                    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                    
                    const force = (repulsion / (distance * distance)) * alpha;
                    const fx = (dx / distance) * force;
                    const fy = (dy / distance) * force;

                    nodeA.vx -= fx;
                    nodeA.vy -= fy;
                    nodeB.vx += fx;
                    nodeB.vy += fy;
                }
            }

            // 2. Attraction along links
            for (const link of physicsLinks) {
                const nodeA = link.sourceNode;
                const nodeB = link.targetNode;
                const dx = nodeB.x - nodeA.x;
                const dy = nodeB.y - nodeA.y;
                const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                
                const force = k * (distance - length) * alpha;
                const fx = (dx / distance) * force;
                const fy = (dy / distance) * force;

                nodeA.vx += fx;
                nodeA.vy += fy;
                nodeB.vx -= fx;
                nodeB.vy -= fy;
            }

            // 3. Center gravity and update positions
            const centerX = dimensions.width / 2;
            const centerY = dimensions.height / 2;
            
            for (const node of physicsNodes) {
                // Gravity to center
                node.vx += (centerX - node.x) * 0.01 * alpha;
                node.vy += (centerY - node.y) * 0.01 * alpha;

                // Apply velocity and friction
                node.x += node.vx;
                node.y += node.vy;
                node.vx *= 0.6; // Increased friction to stop faster
                node.vy *= 0.6;

                // Boundary constraints
                node.x = Math.max(node.radius, Math.min(dimensions.width - node.radius, node.x));
                node.y = Math.max(node.radius, Math.min(dimensions.height - node.radius, node.y));
            }

            alpha *= 0.95; // Cool down
        };

        const draw = (timestamp: number) => {
            updatePhysics();

            ctx.clearRect(0, 0, dimensions.width, dimensions.height);

            // Draw grid background
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
            ctx.lineWidth = 1;
            const step = 20;
            for (let x = 0; x < dimensions.width; x += step) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, dimensions.height);
                ctx.stroke();
            }
            for (let y = 0; y < dimensions.height; y += step) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(dimensions.width, y);
                ctx.stroke();
            }

            // Draw links
            for (const link of physicsLinks) {
                const { sourceNode, targetNode } = link;
                
                ctx.beginPath();
                ctx.moveTo(sourceNode.x, sourceNode.y);
                ctx.lineTo(targetNode.x, targetNode.y);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Draw energy flow
                const time = timestamp / 1000;
                const progress = (time % 2) / 2; // 0 to 1 loop every 2 seconds
                const pulseX = sourceNode.x + (targetNode.x - sourceNode.x) * progress;
                const pulseY = sourceNode.y + (targetNode.y - sourceNode.y) * progress;

                ctx.beginPath();
                ctx.arc(pulseX, pulseY, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#60a5fa'; // Blue pulse
                ctx.shadowBlur = 10;
                ctx.shadowColor = '#60a5fa';
                ctx.fill();
                ctx.shadowBlur = 0; // Reset
            }

            // Draw nodes
            for (const node of physicsNodes) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
                
                let fillColor = 'rgba(25, 25, 30, 0.9)';
                let strokeColor = 'rgba(255, 255, 255, 0.3)';
                let glowColor = 'transparent';

                if (node.status === 'success') {
                    strokeColor = '#10b981'; // Green
                    glowColor = 'rgba(16, 185, 129, 0.3)';
                    fillColor = 'rgba(16, 185, 129, 0.15)'; // Subtle green fill
                } else if (node.status === 'processing') {
                    strokeColor = '#3b82f6'; // Blue
                    glowColor = 'rgba(59, 130, 246, 0.3)';
                    fillColor = 'rgba(59, 130, 246, 0.15)'; // Subtle blue fill
                    
                    // Draw rotating dashed ring for processing
                    ctx.save();
                    ctx.translate(node.x, node.y);
                    ctx.rotate((timestamp / 1000) * Math.PI); // Rotate over time
                    ctx.beginPath();
                    ctx.arc(0, 0, node.radius + 5, 0, Math.PI * 2);
                    ctx.strokeStyle = '#3b82f6';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([5, 5]);
                    ctx.stroke();
                    ctx.restore();
                } else if (node.status === 'error') {
                    strokeColor = '#ef4444'; // Red
                    glowColor = 'rgba(239, 68, 68, 0.3)';
                    fillColor = 'rgba(239, 68, 68, 0.15)'; // Subtle red fill
                }

                ctx.fillStyle = fillColor;
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = 2;

                if (glowColor !== 'transparent') {
                    ctx.shadowBlur = 15;
                    ctx.shadowColor = glowColor;
                }

                ctx.fill();
                ctx.stroke();
                ctx.shadowBlur = 0; // Reset

                // Draw label
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.font = '700 11px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(node.label, node.x, node.y);
            }

            animationFrameId = requestAnimationFrame(draw);
        };

        animationFrameId = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [dimensions, nodes, links]);

    return (
        <div 
            ref={containerRef} 
            className="w-full bg-[#19191e]/40 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden my-4"
            style={{ height: `${dimensions.height}px` }}
        >
            <canvas ref={canvasRef} className="w-full h-full" />
        </div>
    );
};

export default CanvasCard;
