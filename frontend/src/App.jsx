import { useEffect } from 'react';
import { TogglePlayback } from '../wailsjs/go/main/App';

function App() {
    useEffect(() => {
        const onKey = (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                TogglePlayback().catch(console.error);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    return <div id="App" />;
}

export default App;
