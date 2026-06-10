interface Props {
    active: boolean;
    title?: string;
}

export default function WorkingIndicator({ active, title = 'Generating seek thumbnails...' }: Props) {
    if (!active) return null;
    return <div className="working-indicator" title={title} />;
}
