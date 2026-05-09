import React from 'react';
import { ComponentWrapper } from './aura-ui';

interface AuraRendererProps {
    content: string;
    onAction?: (action: string, data: any) => void;
    latestOnly?: boolean;
}

const extractA2UIPayload = (sectionText: string): any => {
    let payload: any = null;
    
    // 1. Try raw JSON
    if (sectionText.startsWith('{') && sectionText.endsWith('}')) {
        try {
            const parsed = JSON.parse(sectionText);
            if (parsed.type === 'a2ui' && parsed.payload) {
                return parsed.payload;
            }
        } catch (e) {}
    }
    
    // 2. Try JSON inside markdown code blocks
    const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/;
    const match = sectionText.match(jsonBlockRegex);
    if (match) {
        try {
            const parsed = JSON.parse(match[1]);
            if (parsed.type === 'a2ui' && parsed.payload) {
                return parsed.payload;
            }
        } catch (e) {}
    }
    
    // 3. Fallback: Search for any object that looks like an A2UI payload
    const genericJsonRegex = /(\{[\s\S]*?"type"\s*:\s*"a2ui"[\s\S]*?\})/;
    const genericMatch = sectionText.match(genericJsonRegex);
    if (genericMatch) {
        try {
            const parsed = JSON.parse(genericMatch[1]);
            if (parsed.type === 'a2ui' && parsed.payload) {
                return parsed.payload;
            }
        } catch (e) {}
    }
    
    return null;
};

export const AuraRenderer = ({ content, onAction, latestOnly = false }: AuraRendererProps) => {

    const allSections = content.split('\n\n___JILING_STEP_SEPARATOR___\n\n').map(s => s.trim()).filter(Boolean);
    const sectionsToRender = latestOnly ? [allSections[allSections.length - 1] || ''] : allSections;

    return (
        <div className="aura-ui-container w-full h-full flex flex-col gap-4">
            {sectionsToRender.map((section, idx) => {
                const payload = extractA2UIPayload(section);
                
                if (payload) {
                    return (
                        <ComponentWrapper 
                            key={idx}
                            component={payload.component} 
                            props={payload.props} 
                            onAction={onAction} 
                        />
                    );
                }

                // Default: Render as NoteCard (Markdown)
                return (
                    <ComponentWrapper 
                        key={idx}
                        component="NoteCard" 
                        props={{ content: section || '' }} 
                    />
                );
            })}
        </div>
    );
};
