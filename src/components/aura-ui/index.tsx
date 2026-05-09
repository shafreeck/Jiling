import React from 'react';
import NoteCard from './NoteCard';
import CodeReviewCard from './CodeReviewCard';
import ApprovalCard from './ApprovalCard';

const Registry: Record<string, React.ComponentType<any>> = {
    'NoteCard': NoteCard,
    'CodeReviewCard': CodeReviewCard,
    'ApprovalCard': ApprovalCard,
};

export const getComponent = (name: string) => {
    return Registry[name];
};

export const ComponentWrapper = ({ component, props, onAction }: { component: string, props: any, onAction?: (action: string, data: any) => void }) => {
    const Comp = getComponent(component);
    if (!Comp) {
        // Fallback to NoteCard if it looks like markdown
        if (component === 'NoteCard' || typeof props?.content === 'string') {
             return <NoteCard content={props?.content || ''} />;
        }
        return <div className="p-2 border border-red-500 rounded text-red-500">Unknown Component: {component}</div>;
    }
    return <Comp {...props} onAction={onAction} />;
}
