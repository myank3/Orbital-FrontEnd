import React, { useState } from 'react';
import { Film, Newspaper, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence, Variants } from 'motion/react';

type ActiveSignal = 'movies' | 'news' | null;

// 🟢 Fast, snappy entrance animations (no heavy blur/spring)
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 }
  },
  exit: { opacity: 0, transition: { duration: 0.15 } }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  show: { 
    opacity: 1, 
    y: 0, 
    transition: { type: 'spring' as const, stiffness: 400, damping: 28 }
  }
};

export default function SignalsPage() {
  const [activeSignal, setActiveSignal] = useState<ActiveSignal>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleOpen = (signal: 'movies' | 'news') => {
    setIsLoading(true);
    setActiveSignal(signal);
  };

  const handleClose = () => {
    setActiveSignal(null);
    setIsLoading(false);
  };

  return (
    <div className="h-full w-full relative overflow-hidden bg-[#0B0A08]">
      
      {/* ── Main Selection View ── */}
      <AnimatePresence mode="wait">
        {!activeSignal && (
          <motion.div 
            variants={containerVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            className="absolute inset-0 flex flex-col items-center justify-center p-4 md:p-6 overflow-y-auto"
          >
            {/* Static ambient glow (No animation, no heavy blur) */}
            <div 
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] md:w-[800px] h-[350px] md:h-[800px] pointer-events-none opacity-40"
              style={{
                background: 'radial-gradient(circle, rgba(217,119,6,0.08) 0%, transparent 70%)'
              }}
            />
            
            {/* Static starfield */}
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-20 pointer-events-none mix-blend-screen" />

            <div className="max-w-4xl w-full z-10 relative py-8 md:py-0">
              
              <div className="mb-10 md:mb-16 text-center flex flex-col items-center">
                <motion.span 
                  variants={itemVariants}
                  className="block text-[10px] md:text-[11px] font-bold tracking-[0.3em] text-[#D97706] uppercase mb-3 md:mb-4"
                >
                  Deep Space
                </motion.span>
                
                <motion.h1 
                  variants={itemVariants}
                  className="text-[36px] md:text-5xl text-[#EDE5D4] mb-3 md:mb-4 tracking-tight"
                  style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
                >
                  Signals
                </motion.h1>
                
                <motion.p 
                  variants={itemVariants}
                  className="text-[#A8A29E] text-[13px] md:text-[16px] max-w-xs md:max-w-md mx-auto leading-relaxed px-4"
                >
                  Expand beyond your immediate orbit. Tune into the frequencies of entertainment and information.
                </motion.p>
              </div>

              <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-12 px-2">
                
                {/* Chalachitra (Movies) */}
                <motion.button
                  variants={itemVariants}
                  whileHover={{ scale: 1.03, y: -4 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleOpen('movies')}
                  className="group relative flex flex-col items-center text-center p-6 md:p-8 rounded-[2rem] bg-[#131110] border border-white/[0.08] hover:border-[#D97706]/50 transition-colors duration-200 w-full max-w-[320px] md:w-[280px] md:h-[280px] justify-center overflow-hidden shadow-2xl"
                >
                  {/* Static dashed ring */}
                  <div className="absolute inset-4 border border-dashed border-[#D97706]/20 rounded-full pointer-events-none" />
                  
                  <div className="absolute inset-0 bg-gradient-to-t from-[#D97706]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  
                  <div className="w-16 h-16 rounded-full bg-[#D97706]/10 flex items-center justify-center mb-5 group-hover:bg-[#D97706]/20 group-hover:scale-105 transition-all duration-200 relative z-10">
                    <Film className="w-7 h-7 text-[#D97706]" />
                  </div>
                  
                  <h2 className="text-2xl font-medium text-[#EDE5D4] mb-2 tracking-wide relative z-10">Chalachitra</h2>
                  <p className="text-[#A8A29E] text-[13px] leading-relaxed px-2 relative z-10">
                    The cinema dimension. Discover films and build your watchlist.
                  </p>
                </motion.button>

                {/* Headlines (News) */}
                <motion.button
                  variants={itemVariants}
                  whileHover={{ scale: 1.03, y: -4 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleOpen('news')}
                  className="group relative flex flex-col items-center text-center p-6 md:p-8 rounded-[2rem] bg-[#131110] border border-white/[0.08] hover:border-[#D97706]/50 transition-colors duration-200 w-full max-w-[320px] md:w-[280px] md:h-[280px] justify-center overflow-hidden shadow-2xl"
                >
                  {/* Static dashed ring */}
                  <div className="absolute inset-4 border border-dashed border-[#D97706]/20 rounded-full pointer-events-none" />

                  <div className="absolute inset-0 bg-gradient-to-t from-[#D97706]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  
                  <div className="w-16 h-16 rounded-full bg-[#D97706]/10 flex items-center justify-center mb-5 group-hover:bg-[#D97706]/20 group-hover:scale-105 transition-all duration-200 relative z-10">
                    <Newspaper className="w-7 h-7 text-[#D97706]" />
                  </div>
                  
                  <h2 className="text-2xl font-medium text-[#EDE5D4] mb-2 tracking-wide relative z-10">The Daily</h2>
                  <p className="text-[#A8A29E] text-[13px] leading-relaxed px-2 relative z-10">
                    The information stream. Catch up on today's top stories.
                  </p>
                </motion.button>

              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Embedded Iframe View ── */}
      <AnimatePresence>
        {activeSignal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 flex flex-col bg-[#0B0A08]"
          >
            {/* Sleek Header Bar */}
            <div className="h-14 md:h-12 shrink-0 border-b border-white/[0.06] flex items-center px-4 bg-[#0F0D0A] z-20">
              <button
                onClick={handleClose}
                className="flex items-center gap-2 text-[13px] font-medium text-[#A8A29E] hover:text-[#D97706] active:text-[#D97706] transition-colors group py-2"
              >
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                <span className="hidden sm:inline">Return to Orbit</span>
                <span className="sm:hidden">Back</span>
              </button>
              <div className="ml-auto flex items-center gap-2 text-[10px] md:text-[11px] uppercase tracking-[0.2em] text-[#6B6259]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-pulse" />
                {activeSignal === 'movies' ? 'Chalachitra' : 'Headline'}
              </div>
            </div>

            {/* The embedded website */}
            <div className="flex-1 w-full bg-[#0B0A08] relative">
              
              {/* Loading Spinner Overlay */}
              <AnimatePresence>
                {isLoading && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0B0A08]"
                  >
                    <div className="w-10 h-10 rounded-full border-2 border-[#D97706]/20 border-t-[#D97706] animate-spin mb-4" />
                    <span className="text-[11px] text-[#D97706] uppercase tracking-[0.2em] font-medium animate-pulse">
                      Establishing Connection
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              <iframe
                src={activeSignal === 'movies' ? "https://chalachitra.vercel.app/" : "https://thedailyheadline.vercel.app/"}
                className="absolute inset-0 w-full h-full border-0"
                title={activeSignal === 'movies' ? "Chalachitra" : "Daily Headline"}
                onLoad={() => setIsLoading(false)}
                allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}