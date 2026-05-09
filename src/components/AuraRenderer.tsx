import React from 'react';
import { ComponentWrapper } from './aura-ui';

interface AuraRendererProps {
    content: string;
    onAction?: (action: string, data: any) => void;
}

export const AuraRenderer = ({ content, onAction }: AuraRendererProps) => {
    // Attempt to parse standard A2UI JSON protocol
    // Standard format: { "type": "a2ui", "payload": { "component": "...", "props": {...} } }
    
    let a2uiPayload: any = null;

    try {
        // 1. Try raw JSON
        const trimmed = content.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            const parsed = JSON.parse(trimmed);
            if (parsed.type === 'a2ui' && parsed.payload) {
                a2uiPayload = parsed.payload;
            }
        }
        
        // 2. Try JSON inside markdown code blocks
        if (!a2uiPayload) {
            const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/;
            const match = content.match(jsonBlockRegex);
            if (match) {
                try {
                    const parsed = JSON.parse(match[1]);
                    if (parsed.type === 'a2ui' && parsed.payload) {
                        a2uiPayload = parsed.payload;
                    }
                } catch (e) {}
            }
        }
        
        // 3. Fallback: Search for any object that looks like an A2UI payload in the text
        if (!a2uiPayload) {
            const genericJsonRegex = /(\{[\s\S]*?"type"\s*:\s*"a2ui"[\s\S]*?\})/;
            const match = content.match(genericJsonRegex);
            if (match) {
                try {
                    const parsed = JSON.parse(match[1]);
                    if (parsed.type === 'a2ui' && parsed.payload) {
                        a2uiPayload = parsed.payload;
                    }
                } catch (e) {}
            }
        }
    } catch (e) {
        // Silently fail and fallback to Markdown if it's not a valid/matching protocol
        console.warn("[AuraRenderer] Failed to parse protocol, falling back to Markdown.");
    }

    if (a2uiPayload) {
        return (
            <div className="aura-ui-container w-full h-full">
                <ComponentWrapper 
                    component={a2uiPayload.component} 
                    props={a2uiPayload.props} 
                    onAction={onAction} 
                />
            </div>
        );
    }

    // Default: Render as NoteCard (Markdown)
    return <ComponentWrapper component="NoteCard" props={{ content }} />;
};
