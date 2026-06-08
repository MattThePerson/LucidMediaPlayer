export default function WorkingIndicator({ active, title = 'Generating seek thumbnails...' }) {
    if (!active) return null;
    return <div className="working-indicator" title={title} />;
}
