import { FlowCanvas } from './canvas/FlowCanvas';
import { Toolbar } from './components/Toolbar';
import { GraphProvider } from './state/graphContext';

export default function App() {
  return (
    <GraphProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <Toolbar />
        <div style={{ flex: 1, minHeight: 0 }}>
          <FlowCanvas />
        </div>
      </div>
    </GraphProvider>
  );
}
