import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PanelState {
  toolsPanel: number;
  copilotPanel: number;
  previewPanel: number;
  propertiesPanel: number;
  mainContent: number;
  timeline: number;
  isCopilotVisible: boolean;
  isToolsExpanded: boolean;

  setToolsPanel: (size: number) => void;
  setCopilotPanel: (size: number) => void;
  setPreviewPanel: (size: number) => void;
  setPropertiesPanel: (size: number) => void;
  setMainContent: (size: number) => void;
  setTimeline: (size: number) => void;
  toggleCopilot: () => void;
  toggleToolsExpanded: () => void;
}

export const usePanelStore = create<PanelState>()(
  persist(
    (set) => ({
      toolsPanel: 30,
      copilotPanel: 30,
      previewPanel: 50,
      propertiesPanel: 25,
      mainContent: 70,
      timeline: 30,
      isCopilotVisible: true,
      isToolsExpanded: false,

      setToolsPanel: (size) => set({ toolsPanel: size }),
      setPreviewPanel: (size) => set({ previewPanel: size }),
      setPropertiesPanel: (size) => set({ propertiesPanel: size }),
      setMainContent: (size) => set({ mainContent: size }),
      setTimeline: (size) => set({ timeline: size }),
      setCopilotPanel: (size) => set({ copilotPanel: size }),
      toggleCopilot: () =>
        set((state) => ({ isCopilotVisible: !state.isCopilotVisible })),
      toggleToolsExpanded: () =>
        set((state) => ({ isToolsExpanded: !state.isToolsExpanded })),
    }),
    {
      name: 'panel-sizes',
      partialize: (state) => {
        const { isToolsExpanded, ...rest } = state;
        return rest;
      },
    }
  )
);
