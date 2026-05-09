import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckSquare, Square, CheckCircle2, XCircle, Activity, Clock } from "lucide-react";

const NoteCard = ({ content }: { content: string }) => {
    return (
        <div className="w-full max-w-none wrap-break-word overflow-x-hidden font-sans">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    h1: ({ node, ...props }) => <h1 className="text-xl font-bold text-white mt-6 mb-3 tracking-tight" {...props} />,
                    h2: ({ node, ...props }) => <h2 className="text-lg font-bold text-white mt-5 mb-2.5 tracking-tight" {...props} />,
                    h3: ({ node, ...props }) => <h3 className="text-base font-bold text-white mt-4 mb-2 tracking-tight" {...props} />,
                    p: ({ node, ...props }) => <div className="text-[13px] leading-6 text-white/90 my-3 wrap-break-word" {...props} />,
                    strong: ({ node, ...props }) => <strong className="font-bold text-white" {...props} />,
                    em: ({ node, ...props }) => <em className="italic text-white/70" {...props} />,
                    ul: ({ node, ...props }) => <ul className="list-disc pl-5 my-3 space-y-1.5" {...props} />,
                    ol: ({ node, ...props }) => <ol className="list-decimal pl-5 my-3 space-y-1.5" {...props} />,
                    li: ({ node, ...props }) => {
                        const children = React.Children.toArray(props.children);
                        const hasCheckbox = children.some((child: any) => child.type === 'input' && child.props.type === 'checkbox');
                        
                        if (hasCheckbox) {
                            const isChecked = children.some((child: any) => child.type === 'input' && child.props.checked);
                            const filteredChildren = children.filter((child: any) => !(child.type === 'input' && child.props.type === 'checkbox'));
                            
                            return (
                                <li className="text-[13px] text-white/90 flex items-start gap-2 my-1.5 list-none -ml-5">
                                    <span className={isChecked ? "text-emerald-500 mt-0.5" : "text-white/30 mt-0.5"}>
                                        {isChecked ? <CheckSquare size={15} /> : <Square size={15} />}
                                    </span>
                                    <span className={isChecked ? "opacity-50 line-through" : ""}>{filteredChildren}</span>
                                </li>
                            );
                        }
                        
                        return <li className="text-[13px] text-white/90" {...props} />;
                    },
                    code: ({ node, inline, ...props }: any) => {
                        const content = String(props.children).replace(/\n$/, "");
                        const isMultiline = content.includes("\n");

                        if (inline) {
                            return <code className="bg-white/10 text-white/90 px-1.5 py-0.5 rounded-md text-[11px] font-mono" {...props} />;
                        }

                        if (!isMultiline) {
                            return (
                                <div className="inline-flex items-center bg-white/10 text-white/90 px-3 py-1 rounded-lg border border-white/10 font-mono text-[11px] my-1">
                                    <code {...props} />
                                </div>
                            );
                        }

                        return (
                            <div className="bg-white/5 p-4 rounded-xl overflow-x-auto my-4 border border-white/10 font-mono whitespace-pre text-[12px] text-white/90">
                                <code {...props} />
                            </div>
                        );
                    },
                    table: ({ node, ...props }) => (
                        <div className="my-6 rounded-xl border border-white/10 overflow-hidden bg-white/2 shadow-xl">
                            <table className="w-full border-collapse border-spacing-0" {...props} />
                        </div>
                    ),
                    thead: ({ node, ...props }) => <thead className="bg-white/5 border-b border-white/10" {...props} />,
                    th: ({ node, ...props }) => <th className="p-3 text-left text-[12px] font-bold text-white uppercase tracking-wider" {...props} />,
                    td: ({ node, ...props }) => <td className="p-3 border-b border-white/5 text-[13px] text-white/80 align-top" {...props} />,
                    blockquote: ({ node, ...props }) => <blockquote className="border-l-4 border-primary/40 pl-4 italic text-white/60 my-4" {...props} />,
                    input: ({node, ...props}: any) => {
                        if (props.type === 'checkbox') {
                            return <input className="accent-emerald-500 opacity-100 mr-2 scale-110" {...props} disabled={false} readOnly={true} />;
                        }
                        return <input {...props} />;
                    },
                    a: ({node, ...props}) => <a className="text-emerald-400 hover:text-emerald-300 underline" {...props} />,
                    hr: ({node, ...props}) => <hr className="border-white/10 my-4" {...props} />,
                    del: ({node, ...props}) => <del className="line-through text-white/40" {...props} />,
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
};

export default NoteCard;
