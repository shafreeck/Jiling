import { useState, useEffect } from 'react';
import { ListTodo, CheckSquare, Square, Send, RefreshCw, Ban } from 'lucide-react';

interface Task {
    id: string;
    title: string;
    completed: boolean;
    description?: string;
    cancelled?: boolean; // New state
    originalTitle?: string; // Keep track for sync
}

interface TaskListCardProps {
    title: string;
    tasks: Task[];
    onAction?: (action: string, data: any) => void;
}

const TaskListCard = (props: TaskListCardProps) => {
    const { title, onAction } = props;

    // Strict Schema: Depend only on explicit 'cancelled' field.
    // We do NOT parse <s> tags. Dirty data implies dirty rendering, which drives upstream correction.
    const [tasks, setTasks] = useState<Task[]>(props.tasks || []);
    const [baselineTasks, setBaselineTasks] = useState<Task[]>(props.tasks || []);

    // Sync state when props change
    useEffect(() => {
        setTasks(props.tasks || []);
        setBaselineTasks(props.tasks || []);
    }, [props.tasks]);

    const toggleTask = (id: string) => {
        const newTasks = tasks.map(t => {
            if (t.id === id) {
                // If cancelled, revive to pending. If completed, to pending. If pending, to completed.
                if (t.cancelled) {
                    return { ...t, cancelled: false, completed: false };
                }
                return { ...t, completed: !t.completed };
            }
            return t;
        });
        setTasks(newTasks);
    };

    const handleSync = () => {
        // Export structured data (Schema First)
        const exportTasks = tasks.map(t => ({
            ...t,
            title: t.title,
            cancelled: !!t.cancelled
        }));
        onAction?.('tasks_sync', { tasks: exportTasks });
        setBaselineTasks([...tasks]);
    };

    // Deep compare
    const hasChanges = tasks.some((task) => {
        const baseline = baselineTasks.find(bt => bt.id === task.id);
        if (!baseline) return true;
        return baseline.completed !== task.completed || baseline.cancelled !== task.cancelled;
    }) || tasks.length !== baselineTasks.length;

    const completedCount = tasks.filter(t => t.completed).length;
    const cancelledCount = tasks.filter(t => t.cancelled).length;
    const progress = tasks.length > 0 ? (completedCount / (tasks.length - cancelledCount)) * 100 : 0; // Exclude cancelled from denominator? Or just count? user preference. standard is completed/total.

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                background: 'rgba(25, 25, 30, 0.4)',
                backdropFilter: 'blur(12px)',
                borderRadius: '24px',
                border: '1px solid rgba(255,255,255,0.08)',
                overflow: 'hidden',
                color: '#fff',
                boxShadow: '0 20px 40px rgba(0,0,0,0.2)'
            }}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
        >
            {/* Header Area */}
            <div style={{ padding: '24px 24px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '12px',
                        background: 'rgba(16, 185, 129, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#10b981',
                        border: '1px solid rgba(16, 185, 129, 0.2)'
                    }}>
                        <ListTodo size={20} />
                    </div>
                    <div>
                        <div style={{ fontSize: '1.1rem', fontWeight: '800', letterSpacing: '-0.02em' }}>{title}</div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.5, fontWeight: '600', marginTop: '2px' }}>
                            {completedCount} 完成 / {cancelledCount > 0 ? `${cancelledCount} 放弃 / ` : ''} {tasks.length} 总计
                        </div>
                    </div>
                </div>

                {/* Refined Progress Bar */}
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                        height: '100%',
                        width: `${progress}%`,
                        background: 'linear-gradient(90deg, #10b981, #34d399)',
                        transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
                        boxShadow: '0 0 10px rgba(16, 185, 129, 0.3)'
                    }} />
                </div>
            </div>

            {/* Task List Body */}
            <div style={{ padding: '0 12px 12px' }}>
                {tasks.map((task) => (
                    <div
                        key={task.id}
                        onClick={() => toggleTask(task.id)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '14px',
                            padding: '12px 16px',
                            borderRadius: '16px',
                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                            cursor: 'pointer',
                            background: task.completed ? 'rgba(255,255,255,0.02)' : (task.cancelled ? 'rgba(255,50,50,0.02)' : 'transparent'),
                            marginBottom: '4px',
                            opacity: task.cancelled ? 0.6 : 1
                        }}
                        className="task-item-hover"
                    >
                        <div style={{
                            color: task.completed ? '#10b981' : (task.cancelled ? '#ef4444' : 'rgba(255,255,255,0.2)'),
                            transition: 'all 0.3s ease',
                            display: 'flex',
                            alignItems: 'center'
                        }}>
                            {task.cancelled ? <Ban size={20} /> : (task.completed ? <CheckSquare size={20} /> : <Square size={20} />)}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{
                                fontSize: '0.9rem',
                                fontWeight: '600',
                                textDecoration: task.completed || task.cancelled ? 'line-through' : 'none',
                                color: task.completed ? 'rgba(255,255,255,0.3)' : (task.cancelled ? '#ef4444' : '#ffffff'),
                                transition: 'all 0.3s ease',
                                lineHeight: '1.4'
                            }}>
                                {task.title}
                            </div>
                            {task.description && (
                                <div style={{ fontSize: '0.75rem', opacity: 0.4, marginTop: '4px', lineHeight: '1.5' }}>
                                    {task.description}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Smart Action Footer */}
            {hasChanges && (
                <div style={{
                    padding: '16px 24px',
                    background: 'rgba(16, 185, 129, 0.05)',
                    borderTop: '1px solid rgba(16, 185, 129, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    animation: 'slide-up 0.3s ease-out'
                }}>
                    <div style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <RefreshCw size={12} className="animate-spin-slow" /> 已记录修改
                    </div>
                    <button
                        onClick={handleSync}
                        style={{
                            background: 'rgba(16, 185, 129, 0.12)',
                            color: '#10b981',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            borderRadius: '10px',
                            padding: '8px 16px',
                            fontSize: '0.8rem',
                            fontWeight: '800',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            transition: 'all 0.2s ease',
                        }}
                        className="sync-btn-refined"
                    >
                        <Send size={14} /> 提交给 AI
                    </button>
                </div>
            )}

            <style>{`
                .task-item-hover:hover {
                    background: rgba(255,255,255,0.05) !important;
                    transform: translateX(4px);
                }
                .sync-btn-refined:hover {
                    background: #059669;
                    transform: translateY(-1px);
                    box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4);
                }
                .sync-btn-refined:active {
                    transform: translateY(0);
                }
                @keyframes slide-up {
                    from { transform: translateY(10px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                .animate-spin-slow {
                    animation: spin 3s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default TaskListCard;
