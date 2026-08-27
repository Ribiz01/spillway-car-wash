"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Camera, RefreshCcw, AlertTriangle } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';
import { AnimatePresence, motion } from 'framer-motion';

interface VehicleCameraProps {
  onCapture: (imageDataUri: string) => void;
  onClose: () => void;
}

export function VehicleCamera({ onCapture, onClose }: VehicleCameraProps) {
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The live stream outlives any single <video> element: reviewing a capture
  // unmounts the preview, and Retake mounts a brand new one that needs re-wiring.
  const streamRef = useRef<MediaStream | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const getCameraPermission = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setHasCameraPermission(false);
        toast({
          variant: 'destructive',
          title: 'Camera Not Supported',
          description: 'Your browser does not support camera access.',
        });
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        streamRef.current = stream;
        setHasCameraPermission(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (error) {
        console.error('Error accessing camera:', error);
        setHasCameraPermission(false);
      }
    };

    getCameraPermission();

    return () => {
      // Cleanup: stop video stream when component unmounts
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, []);

  // Re-bind the stream every time the live preview comes back on screen. Without
  // this, "Retake" renders a fresh <video> with no srcObject: the preview stays
  // black and Capture fails with a zero-dimension video.
  useEffect(() => {
    if (!capturedImage && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [capturedImage]);

  const handleCapture = useCallback(() => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      // Ensure video has dimensions before capturing
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        toast({
            variant: "destructive",
            title: "Camera Error",
            description: "Video stream not available. Please wait a moment and try again."
        });
        return;
      }
      // The photo is stored inline on the vehicle document as a base64 data URI,
      // and a Firestore document is hard-capped at 1 MiB. A full-resolution phone
      // capture blows straight past that (and base64 adds a further ~33%), so the
      // write would be rejected outright. Downscale to a long edge of 1280px and
      // encode at 0.7 — plenty to identify a vehicle, and comfortably under cap.
      const MAX_EDGE = 1280;
      const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUri = canvas.toDataURL('image/jpeg', 0.7);
        setCapturedImage(dataUri);
      }
    }
  }, [toast]);

  const handleConfirm = () => {
    if (capturedImage) {
      onCapture(capturedImage);
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
  };
  
  const motionProps = {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
    transition: { duration: 0.2 }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
        <motion.div {...motionProps} className="bg-card rounded-lg shadow-xl w-full max-w-2xl">
            <div className="p-4 border-b">
                <h2 className="text-lg font-semibold">{capturedImage ? 'Confirm Photo' : 'Capture Photo'}</h2>
            </div>
            <div className="p-4">
                <div className="relative aspect-video w-full bg-muted rounded-md overflow-hidden flex items-center justify-center">
                   <AnimatePresence mode="wait">
                    {capturedImage ? (
                         <motion.img key="img" {...motionProps} src={capturedImage} alt="Captured vehicle" className="object-contain h-full w-full" />
                    ) : (
                        <motion.div key="video-wrapper" {...motionProps} className="w-full h-full relative">
                            <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                            {hasCameraPermission === false && (
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4">
                                    <Alert variant="destructive">
                                        <AlertTriangle className="h-4 w-4" />
                                        <AlertTitle>Camera Access Required</AlertTitle>
                                        <AlertDescription>
                                            Camera access was denied. You need to enable it in your browser's site settings for this website.
                                        </AlertDescription>
                                    </Alert>
                                </div>
                            )}
                        </motion.div>
                    )}
                    </AnimatePresence>
                </div>
                 <canvas ref={canvasRef} className="hidden" />
            </div>
            <div className="p-4 border-t flex justify-between items-center">
                 <Button variant="outline" onClick={onClose}>Cancel</Button>
                {capturedImage ? (
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={handleRetake}><RefreshCcw className="mr-2"/>Retake</Button>
                        <Button onClick={handleConfirm}>Use Photo</Button>
                    </div>
                ) : (
                    <Button onClick={handleCapture} disabled={hasCameraPermission !== true}>
                        <Camera className="mr-2" /> Capture
                    </Button>
                )}
            </div>
        </motion.div>
    </div>
  );
}
