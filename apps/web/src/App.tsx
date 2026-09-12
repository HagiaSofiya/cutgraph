import { ReactFlowProvider } from '@xyflow/react';
import { FlowCanvas } from './canvas/FlowCanvas';
import { Toolbar } from './components/Toolbar';
import { GraphProvider } from './state/graphContext';

export default function App() {
  return (
    <GraphProvider>
      {/* The provider wraps the Toolbar too, not just the canvas: "Load sample" replaces every
          node id at once and needs fitView to bring the new pipeline back into view. */}
      <ReactFlowProvider>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
          <Toolbar />
          <div style={{ flex: 1, minHeight: 0 }}>
            <FlowCanvas />
          </div>
        </div>
      </ReactFlowProvider>
    </GraphProvider>
  );
}
