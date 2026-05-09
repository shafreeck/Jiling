import { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, FileCode, MessageSquare, Maximize2, X, Plus } from 'lucide-react';
import { createPortal } from 'react-dom';

interface FileItem {
    filename: string;
    content: string;
    language?: string;
}

interface CodeReviewProps {
    fileName?: string;
    diff?: string;
    language?: string;
    files?: FileItem[];
    status?: 'pending' | 'approved' | 'rejected';
    initialComment?: string;
    initialLineComments?: Record<number, string>;
    onAction?: (action: string, data: any) => void;
}

const CodeReviewCard = (props: CodeReviewProps) => {
    const files = props.files || [
        { 
            filename: props.fileName || 'unknown', 
            content: props.diff || '', 
            language: props.language 
        }
    ];
    
    const [activeIndex, setActiveIndex] = useState(0);
    const activeFile = files[activeIndex] || files[0];
    
    const fileName = activeFile.filename;
    const diff = activeFile.content;
    const language = activeFile.language;
    
    const { onAction } = props;
    const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>(props.status || 'pending');
    const [comment, setComment] = useState(props.initialComment || '');
    const [showComment, setShowComment] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [lineComments, setLineComments] = useState<Record<number, string>>(props.initialLineComments || {});

    // Sync state when props change
    useEffect(() => {
        if (props.status) setStatus(props.status);
        if (props.initialComment) setComment(props.initialComment);
        if (props.initialLineComments) setLineComments(props.initialLineComments);
    }, [props.status, props.initialComment, props.initialLineComments]);
    const [activeLineComment, setActiveLineComment] = useState<number | null>(null);
    const [activeLineInput, setActiveLineInput] = useState('');

    const safeDiff = diff || '';
    const lines = safeDiff.split('\n');

    const handleAction = (type: 'approve' | 'reject') => {
        if (status !== 'pending') return;
        setStatus(type === 'approve' ? 'approved' : 'rejected');
        onAction?.(type, {
            fileName,
            comment: comment.trim() || undefined,
            lineComments: Object.keys(lineComments).length > 0 ? lineComments : undefined
        });
    };

    const addLineComment = (lineIdx: number) => {
        if (status !== 'pending') return;
        setActiveLineComment(lineIdx);
        setActiveLineInput(lineComments[lineIdx] || '');
    };

    const saveLineComment = () => {
        if (activeLineComment === null) return;
        const newComments = { ...lineComments };
        if (activeLineInput.trim()) {
            newComments[activeLineComment] = activeLineInput.trim();
        } else {
            delete newComments[activeLineComment];
        }
        setLineComments(newComments);
        setActiveLineComment(null);
    };

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                width: '100%',
                height: '100%',
                color: '#fff',
                position: 'relative'
            }}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
        >
            {/* Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 4px',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: 'rgba(59, 130, 246, 0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#3b82f6'
                    }}>
                        <FileCode size={18} />
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: '700' }}>{fileName}</div>
                        <div style={{ fontSize: '0.65rem', opacity: 0.5 }}>{language || 'typescript'}</div>
                    </div>
                </div>
            </div>

            {/* File Tabs */}
            {files.length > 1 && (
                <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '4px', marginBottom: '4px' }}>
                    {files.map((file, idx) => (
                        <button
                            key={idx}
                            onClick={() => setActiveIndex(idx)}
                            style={{
                                padding: '6px 12px',
                                background: idx === activeIndex ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.02)',
                                border: '1px solid',
                                borderColor: idx === activeIndex ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                                borderRadius: '8px',
                                color: idx === activeIndex ? '#3b82f6' : 'rgba(255,255,255,0.6)',
                                fontSize: '0.75rem',
                                fontWeight: idx === activeIndex ? '700' : '400',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            {file.filename.split('/').pop()}
                        </button>
                    ))}
                </div>
            )}

            {/* Diff View */}
            <div
                onClick={() => setIsExpanded(true)}
                style={{
                    flex: 1,
                    background: 'rgba(0,0,0,0.25)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255,255,255,0.05)',
                    overflow: 'hidden',
                    padding: '12px',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    maxHeight: '240px',
                    cursor: 'pointer',
                    position: 'relative'
                }}
            >
                {lines.slice(0, 10).map((line, i) => {
                    const isAdded = line.startsWith('+');
                    const isRemoved = line.startsWith('-');
                    const color = isAdded ? '#4ade80' : isRemoved ? '#f87171' : 'rgba(255,255,255,0.4)';
                    return <div key={i} style={{ color, whiteSpace: 'pre', fontSize: '0.75rem' }}>{line}</div>;
                })}
                {lines.length > 10 && <div style={{ fontSize: '0.7rem', opacity: 0.3, marginTop: '4px' }}>... {lines.length - 10} more lines</div>}

                {/* Maximize Overlay Hint */}
                <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: '60px',
                    background: 'linear-gradient(to top, rgba(25,25,30,0.8), transparent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    color: '#3b82f6',
                    fontSize: '0.75rem',
                    fontWeight: '700'
                }}>
                    <Maximize2 size={14} /> 点击查看完整 DIFF 详情
                </div>
            </div>

            {/* Comment Preview (if exists) */}
            {Object.keys(lineComments).length > 0 && (
                <div style={{ display: 'flex', gap: '6px', fontSize: '0.7rem', color: '#3b82f6', background: 'rgba(59, 130, 246, 0.1)', padding: '6px 10px', borderRadius: '8px' }}>
                    <MessageSquare size={12} /> 已添加 {Object.keys(lineComments).length} 条行内评论
                </div>
            )}

            {/* Global Actions */}
            <div style={{
                display: 'flex',
                gap: '8px',
                marginTop: '4px'
            }}>
                <button
                    onClick={() => setShowComment(!showComment)}
                    style={{
                        padding: '10px',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '10px',
                        color: showComment ? '#3b82f6' : '#fff',
                        cursor: 'pointer'
                    }}
                    title="添加全局评论"
                >
                    <MessageSquare size={18} />
                </button>

                <button
                    onClick={() => handleAction('approve')}
                    disabled={status !== 'pending'}
                    style={{
                        flex: 1,
                        background: status === 'approved' ? '#059669' : (status === 'rejected' ? 'rgba(255,255,255,0.02)' : 'linear-gradient(135deg, #059669 0%, #10b981 100%)'),
                        border: 'none',
                        borderRadius: '10px',
                        padding: '10px',
                        color: 'white',
                        fontSize: '0.8rem',
                        fontWeight: '700',
                        cursor: status === 'pending' ? 'pointer' : 'default',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        opacity: status === 'rejected' ? 0.3 : 1
                    }}
                >
                    <CheckCircle2 size={16} /> {status === 'approved' ? '已接受' : '接受修改'}
                </button>
                <button
                    onClick={() => handleAction('reject')}
                    disabled={status !== 'pending'}
                    style={{
                        flex: 1,
                        background: status === 'rejected' ? '#b91c1c' : 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '10px',
                        padding: '10px',
                        color: 'white',
                        fontSize: '0.8rem',
                        fontWeight: '700',
                        cursor: status === 'pending' ? 'pointer' : 'default',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        opacity: status === 'approved' ? 0.3 : 1
                    }}
                >
                    <XCircle size={16} /> {status === 'rejected' ? '已拒绝' : '拒绝修改'}
                </button>
            </div>

            {/* Global Comment Area */}
            {showComment && status === 'pending' && (
                <div style={{ marginTop: '4px' }}>
                    <textarea
                        autoFocus
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="在此输入全局反馈意见..."
                        style={{
                            width: '100%',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '10px',
                            padding: '10px',
                            color: '#fff',
                            fontSize: '0.8rem',
                            minHeight: '60px',
                            resize: 'none',
                            outline: 'none'
                        }}
                    />
                </div>
            )}

            {/* Portal Overlay */}
            {isExpanded && createPortal(
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    backgroundColor: 'rgba(0,0,0,0.85)',
                    backdropFilter: 'blur(10px)',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '40px'
                }}>
                    <div style={{
                        width: '100%',
                        maxWidth: '1000px',
                        height: '100%',
                        background: 'rgba(25, 25, 30, 0.95)',
                        borderRadius: '24px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        boxShadow: '0 24px 60px rgba(0,0,0,0.8)'
                    }}>
                        {/* FullView Header */}
                        <div style={{
                            padding: '24px',
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <FileCode size={24} color="#3b82f6" />
                                <div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: '#fff' }}>{fileName}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>详细代码评审详情</div>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsExpanded(false)}
                                style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '50%', width: '40px', height: '40px', color: '#fff', cursor: 'pointer' }}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* FullView Diff */}
                        <div style={{ flex: 1, overflow: 'auto', padding: '24px', fontFamily: 'monospace' }}>
                            {lines.map((line, i) => {
                                const isAdded = line.startsWith('+');
                                const isRemoved = line.startsWith('-');
                                const bgColor = isAdded ? 'rgba(34, 197, 94, 0.1)' : isRemoved ? 'rgba(239, 68, 68, 0.1)' : 'transparent';
                                const color = isAdded ? '#4ade80' : isRemoved ? '#f87171' : 'rgba(255,255,255,0.7)';
                                const hasComment = lineComments[i];

                                return (
                                    <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
                                        <div
                                            onClick={() => addLineComment(i)}
                                            style={{
                                                display: 'flex',
                                                backgroundColor: bgColor,
                                                cursor: status === 'pending' ? 'pointer' : 'default',
                                                borderRadius: '4px',
                                                minHeight: '28px',
                                                alignItems: 'center',
                                                transition: 'background 0.2s'
                                            }}
                                            className="review-line-hover"
                                        >
                                            <div style={{ width: '40px', textAlign: 'right', paddingRight: '12px', opacity: 0.3, userSelect: 'none', fontSize: '0.75rem' }}>{i + 1}</div>
                                            <div style={{ flex: 1, color: color, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.9rem' }}>{line}</div>
                                            {status === 'pending' && <div className="plus-icon" style={{ padding: '0 8px', opacity: 0, transition: 'opacity 0.2s' }}><Plus size={14} /></div>}
                                        </div>

                                        {/* Line Comment Input */}
                                        {activeLineComment === i && (
                                            <div style={{ margin: '8px 40px', padding: '12px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                                                <textarea
                                                    autoFocus
                                                    value={activeLineInput}
                                                    onChange={(e) => setActiveLineInput(e.target.value)}
                                                    placeholder="为此行添加评论..."
                                                    style={{ width: '100%', background: 'transparent', border: 'none', color: '#fff', outline: 'none', resize: 'none', minHeight: '60px' }}
                                                />
                                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                                                    <button onClick={() => setActiveLineComment(null)} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', cursor: 'pointer' }}>取消</button>
                                                    <button onClick={saveLineComment} style={{ background: '#3b82f6', border: 'none', color: '#fff', borderRadius: '6px', padding: '4px 12px', fontSize: '0.8rem', cursor: 'pointer' }}>保存</button>
                                                </div>
                                            </div>
                                        )}

                                        {/* Displayed Line Comment */}
                                        {hasComment && activeLineComment !== i && (
                                            <div style={{
                                                margin: '8px 40px 12px',
                                                padding: '12px 16px',
                                                background: 'rgba(59, 130, 246, 0.05)',
                                                borderRadius: '12px',
                                                border: '1px solid rgba(59, 130, 246, 0.15)',
                                                borderLeft: '4px solid #3b82f6',
                                                fontSize: '0.9rem',
                                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                                            }}>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                                                    <div style={{
                                                        fontWeight: '800',
                                                        fontSize: '0.7rem',
                                                        color: '#3b82f6',
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.05em',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px'
                                                    }}>
                                                        <MessageSquare size={12} />
                                                        行内评论反馈
                                                    </div>
                                                    <div style={{ flex: 1 }} />
                                                    {status === 'pending' && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const newC = { ...lineComments }; delete newC[i]; setLineComments(newC);
                                                            }}
                                                            style={{
                                                                background: 'transparent',
                                                                border: 'none',
                                                                color: 'rgba(255,255,255,0.3)',
                                                                cursor: 'pointer',
                                                                padding: '2px',
                                                                borderRadius: '4px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                transition: 'color 0.2s'
                                                            }}
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    )}
                                                </div>
                                                <div style={{ color: '#ffffff', lineHeight: '1.5', fontWeight: '400' }}>
                                                    {hasComment}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Footer Actions in FullView */}
                        <div style={{ padding: '24px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: '12px' }}>
                            <button onClick={() => handleAction('approve')} disabled={status !== 'pending'} style={{ flex: 1, padding: '14px', borderRadius: '12px', background: '#10b981', color: '#fff', border: 'none', fontWeight: '700', cursor: 'pointer', opacity: status === 'pending' ? 1 : 0.5 }}>接受修改</button>
                            <button onClick={() => handleAction('reject')} disabled={status !== 'pending'} style={{ flex: 1, padding: '14px', borderRadius: '12px', background: '#ef4444', color: '#fff', border: 'none', fontWeight: '700', cursor: 'pointer', opacity: status === 'pending' ? 1 : 0.5 }}>拒绝修改</button>
                        </div>
                    </div>

                    <style>{`
                        .review-line-hover:hover { background: rgba(255,255,255,0.05) !important; }
                        .review-line-hover:hover .plus-icon { opacity: 1 !important; }
                    `}</style>
                </div>,
                document.body
            )}
        </div>
    );
};

export default CodeReviewCard;
