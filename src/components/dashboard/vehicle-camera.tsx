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
        setHasCameraPermission(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (error) {
        console.error('Error accessing camera:', error);
        setHasCameraPermission(false);
        toast({
          variant: 'destructive',
          title: 'Camera Access Denied',
          description: 'Please enable camera permissions in your browser settings.',
        });
      }
    };

    getCameraPermission();

    return () => {
      // Cleanup: stop video stream when component unmounts
      if (videoRef.current && videoRef.current.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      }
    };
  }, [toast]);

  const handleCapture = useCallback(() => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        const dataUri = canvas.toDataURL('image/jpeg');
        setCapturedImage(dataUri);
      }
    }
  }, []);

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
                        hasCameraPermission === null ? (
                            <p>Requesting camera permission...</p>
                        ) : hasCameraPermission === true ? (
                            <motion.video key="vid" {...motionProps} ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                        ) : (
                            <motion.div key="alert" {...motionProps} className="p-4">
                                <Alert variant="destructive">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle>Camera Access Required</AlertTitle>
                                    <AlertDescription>
                                        Camera access was denied or is not available. Please check your browser settings and permissions.
                                    </AlertDescription>
                                </Alert>
                            </motion.div>
                        )
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
                    <Button onClick={handleCapture} disabled={!hasCameraPermission}>
                        <Camera className="mr-2" /> Capture
                    </Button>
                )}
            </div>
        </motion.div>
    </div>
  );
}
