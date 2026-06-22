import { motion } from 'framer-motion';

export const AdOverlay = () => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-bolt-elements-background-depth-1/90 backdrop-blur-sm"
    >
      <div className="text-4xl font-bold flex-col gap-2 justify-center items-center text-bolt-elements-textPrimary">
        AD header
        <button>Go to ad page</button>
      </div>
    </motion.div>
  );
};
