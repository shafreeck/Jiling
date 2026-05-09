import { useState, useEffect } from 'react';
import { ShieldCheck, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

interface ApprovalCardProps {
    title: string;
    description: string;
    actionLabel?: string;
    severity?: 'info' | 'warning' | 'critical';
    status?: 'pending' | 'approved' | 'rejected';
    onAction?: (action: string, data: any) => void;
}

const ApprovalCard = (props: ApprovalCardProps) => {
    const { title, description, actionLabel, severity = 'info', onAction } = props;
    const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>(props.status || 'pending');

    // Sync state when props change
    useEffect(() => {
        if (props.status) setStatus(props.status);
    }, [props.status]);

    const handleAction = (type: 'approve' | 'reject') => {
        if (status !== 'pending') return;
        setStatus(type === 'approve' ? 'approved' : 'rejected');
        onAction?.(type, { title, actionLabel });
    };

    const getSeverityStyles = () => {
        switch (severity) {
            case 'critical':
                return {
                    icon: <AlertTriangle size={20} color="#ef4444" />,
                    bg: 'rgba(239, 68, 68, 0.1)',
                    border: 'rgba(239, 68, 68, 0.2)',
                    accent: '#ef4444'
                };
            case 'warning':
                return {
                    icon: <AlertTriangle size={20} color="#f59e0b" />,
                    bg: 'rgba(245, 158, 11, 0.1)',
                    border: 'rgba(245, 158, 11, 0.2)',
                    accent: '#f59e0b'
                };
            default:
                return {
                    icon: <ShieldCheck size={20} color="#3b82f6" />,
                    bg: 'rgba(59, 130, 246, 0.1)',
                    border: 'rgba(59, 130, 246, 0.2)',
                    accent: '#3b82f6'
                };
        }
    };

    const styles = getSeverityStyles();

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                width: '100%',
                padding: '20px',
                background: 'rgba(25, 25, 30, 0.4)',
                backdropFilter: 'blur(10px)',
                borderRadius: '20px',
                border: `1px solid ${styles.border}`,
                color: '#fff',
                position: 'relative',
                overflow: 'hidden'
            }}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
        >
            {/* Header */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '12px',
                    background: styles.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                }}>
                    {styles.icon}
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '4px' }}>{title}</div>
                    <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.9)', lineHeight: '1.5' }}>
                        {description}
                    </div>
                </div>
            </div>

            {/* Severity Badge */}
            <div style={{
                position: 'absolute',
                top: '12px',
                right: '12px',
                fontSize: '0.65rem',
                fontWeight: '800',
                padding: '4px 8px',
                borderRadius: '6px',
                background: styles.bg,
                color: styles.accent,
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
            }}>
                {severity}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px' }}>
                <button
                    onClick={() => handleAction('approve')}
                    disabled={status !== 'pending'}
                    style={{
                        flex: 1,
                        background: status === 'approved' ? '#059669' : (status === 'rejected' ? 'rgba(255,255,255,0.02)' : `linear-gradient(135deg, ${styles.accent} 0%, ${styles.accent}cc 100%)`),
                        border: 'none',
                        borderRadius: '12px',
                        padding: '12px',
                        color: 'white',
                        fontSize: '0.85rem',
                        fontWeight: '700',
                        cursor: status === 'pending' ? 'pointer' : 'default',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        transition: 'all 0.2s',
                        boxShadow: status === 'pending' ? `0 4px 15px ${styles.accent}33` : 'none',
                        opacity: status === 'rejected' ? 0.3 : 1
                    }}
                >
                    <CheckCircle2 size={18} />
                    {status === 'approved' ? '已授权' : (actionLabel || '确认执行')}
                </button>
                <button
                    onClick={() => handleAction('reject')}
                    disabled={status !== 'pending'}
                    style={{
                        flex: 1,
                        background: status === 'rejected' ? '#b91c1c' : 'rgba(255,255,255,0.12)',
                        border: '1px solid rgba(255,255,255,0.3)',
                        borderRadius: '12px',
                        padding: '12px',
                        color: 'white',
                        fontSize: '0.85rem',
                        fontWeight: '700',
                        cursor: status === 'pending' ? 'pointer' : 'default',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        opacity: status === 'approved' ? 0.3 : 1
                    }}
                >
                    <XCircle size={18} /> {status === 'rejected' ? '已拒绝' : '拒绝'}
                </button>
            </div>
        </div>
    );
};

export default ApprovalCard;
