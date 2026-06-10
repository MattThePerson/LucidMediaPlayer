import { useState, useRef } from 'react';
import type { main } from '../../wailsjs/go/models';

const PRESET_COLORS = [
    '#e05c5c', '#e08c3c', '#d4c44a', '#5cba6e', '#4d8cff', '#9b5ce0',
    '#e05c9b', '#5cc8e0', '#c87c4a', '#6e5ce0', '#a0a0a0', '#e0e0e0',
];

interface ColorPickerProps {
    current: string;
    onSelect: (color: string) => void;
}

function ColorPicker({ current, onSelect }: ColorPickerProps) {
    return (
        <div className="color-picker-grid">
            <button
                className={`color-swatch color-swatch-none${!current ? ' selected' : ''}`}
                title="No color"
                onClick={() => onSelect('')}
            >
                ✕
            </button>
            {PRESET_COLORS.map(c => (
                <button
                    key={c}
                    className={`color-swatch${current === c ? ' selected' : ''}`}
                    style={{ background: c }}
                    title={c}
                    onClick={() => onSelect(c)}
                />
            ))}
        </div>
    );
}

interface ProfileRowProps {
    profile: main.ProfileEntry;
    isActive: boolean;
    onRename: (id: string, newName: string) => void;
    onSetColor: (id: string, color: string) => void;
    onOpen: (id: string) => void;
    onRequestDelete: (profile: main.ProfileEntry) => void;
    onDragStart: (e: React.DragEvent<HTMLDivElement>, id: string) => void;
    onDragOver: (id: string) => void;
    onDrop: (id: string) => void;
    isDraggingOver: boolean;
}

function ProfileRow({ profile, isActive, onRename, onSetColor, onOpen, onRequestDelete, onDragStart, onDragOver, onDrop, isDraggingOver }: ProfileRowProps) {
    const [editing, setEditing] = useState(false);
    const [nameVal, setNameVal] = useState(profile.name);
    const [showPicker, setShowPicker] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const commitRename = () => {
        setEditing(false);
        const trimmed = nameVal.trim();
        if (trimmed && trimmed !== profile.name) {
            onRename(profile.id, trimmed);
        } else {
            setNameVal(profile.name);
        }
    };

    const handleNameClick = () => {
        setNameVal(profile.name);
        setEditing(true);
        setTimeout(() => inputRef.current?.select(), 0);
    };

    const handleColorSelect = (color: string) => {
        setShowPicker(false);
        onSetColor(profile.id, color);
    };

    return (
        <div
            className={`profile-list-item${isActive ? ' active' : ''}${isDraggingOver ? ' drag-over' : ''}`}
            draggable={!isActive}
            onDragStart={e => onDragStart(e, profile.id)}
            onDragOver={e => { e.preventDefault(); onDragOver(profile.id); }}
            onDrop={e => { e.preventDefault(); onDrop(profile.id); }}
        >
            <span className="profile-drag-handle" title={isActive ? '' : 'Drag to reorder'}>
                {isActive ? '' : '⠿'}
            </span>

            <div className="profile-color-btn-wrap">
                <button
                    className="profile-color-btn"
                    style={profile.color ? { background: profile.color } : {}}
                    title="Change color"
                    onClick={() => setShowPicker(v => !v)}
                >
                    {!profile.color && <span style={{ color: '#666', fontSize: 10 }}>✕</span>}
                </button>
                {showPicker && (
                    <div className="color-picker-popup">
                        <ColorPicker current={profile.color} onSelect={handleColorSelect} />
                    </div>
                )}
            </div>

            <div className="profile-name-cell">
                {editing ? (
                    <input
                        ref={inputRef}
                        className="profile-name-input"
                        value={nameVal}
                        onChange={e => setNameVal(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={e => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') { setEditing(false); setNameVal(profile.name); }
                        }}
                    />
                ) : (
                    <span
                        className="profile-name"
                        onClick={handleNameClick}
                        title="Click to rename"
                    >
                        {profile.name}
                        {isActive && <span className="profile-active-label"> (active)</span>}
                    </span>
                )}
            </div>

            <div className="profile-row-actions">
                {!isActive && (
                    <>
                        <button className="profile-action-btn" onClick={() => onOpen(profile.id)} title="Open this profile in a new window">
                            Open
                        </button>
                        <button className="profile-action-btn profile-delete-btn" onClick={() => onRequestDelete(profile)} title="Delete profile">
                            Delete
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

interface DeleteModalProps {
    profile: main.ProfileEntry;
    onConfirm: () => void;
    onCancel: () => void;
}

function DeleteModal({ profile, onConfirm, onCancel }: DeleteModalProps) {
    return (
        <div className="profile-delete-backdrop" onClick={onCancel}>
            <div className="profile-delete-dialog" onClick={e => e.stopPropagation()}>
                <div className="profile-delete-dialog-title">Delete profile?</div>
                <div className="profile-delete-dialog-name">{profile.name}</div>
                <div className="profile-delete-dialog-sub">Watch history and settings remain on disk.</div>
                <div className="profile-delete-dialog-actions">
                    <button className="profile-action-btn" onClick={onCancel}>Cancel</button>
                    <button className="profile-action-btn profile-delete-confirm-btn" onClick={onConfirm}>Delete</button>
                </div>
            </div>
        </div>
    );
}

interface Props {
    profiles: main.ProfileEntry[];
    activeProfileId: string;
    onCreate: (name: string, color: string) => Promise<main.ProfileEntry>;
    onRename: (id: string, newName: string) => void;
    onSetColor: (id: string, color: string) => void;
    onDelete: (id: string) => void;
    onReorder: (ids: string[]) => void;
    onOpen: (id: string) => void;
}

export default function ManageProfilesPage({ profiles, activeProfileId, onCreate, onRename, onSetColor, onDelete, onReorder, onOpen }: Props) {
    const [dragId, setDragId] = useState<string | null>(null);
    const [overId, setOverId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<main.ProfileEntry | null>(null);

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, id: string) => {
        setDragId(id);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (id: string) => {
        if (id !== dragId) setOverId(id);
    };

    const handleDrop = (targetId: string) => {
        if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
        const ids = profiles.map(p => p.id);
        const fromIdx = ids.indexOf(dragId);
        const toIdx = ids.indexOf(targetId);
        if (fromIdx === -1 || toIdx === -1) { setDragId(null); setOverId(null); return; }
        const newIds = [...ids];
        newIds.splice(fromIdx, 1);
        newIds.splice(toIdx, 0, dragId);
        onReorder(newIds);
        setDragId(null);
        setOverId(null);
    };

    const handleCreate = async () => {
        const color = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)] ?? '';
        await onCreate('New Profile', color);
    };

    const handleConfirmDelete = () => {
        if (deleteTarget) onDelete(deleteTarget.id);
        setDeleteTarget(null);
    };

    return (
        <div className="manage-profiles-page">
            <h2 className="manage-profiles-title">Profiles</h2>
            <div className="profile-list">
                {profiles.map(p => (
                    <ProfileRow
                        key={p.id}
                        profile={p}
                        isActive={p.id === activeProfileId}
                        onRename={onRename}
                        onSetColor={onSetColor}
                        onOpen={onOpen}
                        onRequestDelete={setDeleteTarget}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        isDraggingOver={overId === p.id}
                    />
                ))}
            </div>
            <button className="profile-new-btn" onClick={handleCreate}>+ New Profile</button>

            {deleteTarget && (
                <DeleteModal
                    profile={deleteTarget}
                    onConfirm={handleConfirmDelete}
                    onCancel={() => setDeleteTarget(null)}
                />
            )}
        </div>
    );
}
