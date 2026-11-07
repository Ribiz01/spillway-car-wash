"use client";

import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { collection, doc, setDoc, query, where, getDocs, getDocsFromCache } from 'firebase/firestore';
import { useFirestore, useMemoFirebase, FirestorePermissionError, errorEmitter } from '@/firebase';
import { useSyncStatus } from '@/firebase/sync-status';
import { useUser } from "@/firebase/auth/use-user";
import { useCollection } from "@/firebase/firestore/use-collection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { calcTier, type Customer, type Service, type Vehicle, type Transaction } from "@/lib/types";
import { findCustomer, normalizePhone } from "@/lib/customers";
import { Badge } from "../ui/badge";
import { formatCurrency } from "@/lib/utils";
import { Check, ChevronLeft, ChevronRight, Loader2, Sparkles, Wind, Droplets, Car, Camera, Image as ImageIcon, Disc, Star, CloudOff, Pencil, Trophy } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Checkbox } from "../ui/checkbox";
import { Skeleton } from "../ui/skeleton";
import { VehicleCamera } from "./vehicle-camera";
import { scanPlate } from "@/ai/flows/scan-plate-flow";

const vehicleSchema = z.object({
  licensePlate: z.string().min(3, "License plate is required").toUpperCase(),
});

const newVehicleSchema = z.object({
  licensePlate: z.string().min(3).toUpperCase(),
  type: z.enum(["Sedan", "SUV", "Truck", "Minibus"]),
  make: z.string().optional(),
  model: z.string().optional(),
  ownerName: z.string().optional(),
  phoneNumber: z.string().optional(),
  whatsappReceiptConsent: z.boolean().default(false),
});

const servicesSchema = z.object({
  selectedServices: z.array(z.string()).min(1, "Please select at least one service."),
  bayNumber: z.string().optional(),
});

const tierStyles: Record<string, string> = {
  Platinum: "border-purple-400 text-purple-700",
  Gold: "border-amber-400 text-amber-700",
  Silver: "border-slate-400 text-slate-600",
  Bronze: "border-orange-300 text-orange-700",
};

type Step = "vehicle" | "new-vehicle" | "services";

/** Rough "how long ago", for the duplicate check-in warning. */
function waitedFor(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const serviceIcons: { [key: string]: React.ReactNode } = {
    'Exterior Wash': <Droplets className="h-6 w-6 text-primary" />,
    'Interior Vacuum': <Wind className="h-6 w-6 text-primary" />,
    'Wax & Polish': <Sparkles className="h-6 w-6 text-primary" />,
    'Engine Wash': <Car className="h-6 w-6 text-primary" />,
    'Tire Shine': <Disc className="h-6 w-6 text-primary" />,
    'Full Detail': <Star className="h-6 w-6 text-primary" />,
};

/**
 * Check-in. Records that a car has arrived and what is being done to it, then
 * leaves the job sitting as 'In Progress'.
 *
 * No washers and no payment are captured here — those belong to completion,
 * once the work is actually finished and the customer is at the till.
 */
export function Workflow() {
  const [step, setStep] = useState<Step>("vehicle");
  const [currentVehicle, setCurrentVehicle] = useState<Vehicle | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<'scan' | 'capture'>('capture');
  const [vehiclePhotoUri, setVehiclePhotoUri] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isFindingVehicle, setIsFindingVehicle] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isNewVehicleSaved, setIsNewVehicleSaved] = useState(false);
  /** True when the details form is editing a vehicle that already exists. */
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);

  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { isOnline, isServerReachable } = useSyncStatus();
  // A slow link reports navigator.onLine === true while Firestore has already
  // fallen back to cache, so both signals are needed to tell the attendant the
  // truth about whether this check-in has actually left the tablet.
  const isWorkingOffline = !isOnline || !isServerReachable;

  const servicesQuery = useMemoFirebase(() => firestore ? collection(firestore, 'services') : null, [firestore]);
  const { data: allServices, isLoading: isLoadingServices } = useCollection<Service>(servicesQuery);

  // Cars currently on site, so the same plate cannot be checked in twice. Same
  // single-field query shape as Cars On Site, so it costs no extra index.
  const activeJobsQuery = useMemoFirebase(
    () => firestore ? query(collection(firestore, 'transactions'), where('status', '==', 'In Progress')) : null,
    [firestore]
  );
  const { data: activeJobs } = useCollection<Transaction>(activeJobsQuery);

  const vehicleForm = useForm<z.infer<typeof vehicleSchema>>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: { licensePlate: "" },
  });

  const newVehicleForm = useForm<z.infer<typeof newVehicleSchema>>({
    resolver: zodResolver(newVehicleSchema),
    defaultValues: {
      licensePlate: "",
      type: "Sedan",
      make: "",
      model: "",
      ownerName: "",
      phoneNumber: "",
      whatsappReceiptConsent: false,
    },
  });

  const servicesForm = useForm<z.infer<typeof servicesSchema>>({
    resolver: zodResolver(servicesSchema),
    defaultValues: { selectedServices: [], bayNumber: "" },
  });

  const handleVehicleSubmit = async (data: z.infer<typeof vehicleSchema>) => {
    if (!firestore) return;

    // A plate already on site is nearly always a double check-in — two attendants
    // recording the same arrival. Two jobs for one car means one gets paid and
    // the other blocks the day from closing, so refuse it up front.
    const alreadyIn = activeJobs?.find((j) => j.licensePlate === data.licensePlate);
    if (alreadyIn) {
      toast({
        title: `${data.licensePlate} is already checked in`,
        description: `Added ${waitedFor(alreadyIn.timestamp)} ago${
          alreadyIn.userName ? ` by ${alreadyIn.userName}` : ''
        }. Find it in Cars On Site to take payment.`,
        variant: 'destructive',
      });
      return;
    }

    setIsFindingVehicle(true);
    try {
      const vehiclesRef = collection(firestore, 'vehicles');
      const q = query(vehiclesRef, where("licensePlate", "==", data.licensePlate));

      // Offline, getDocs can hang or reject waiting for the server. Fall back to
      // whatever the device already has cached so a known regular can still be
      // served during a network outage.
      //
      // This checks isWorkingOffline rather than navigator.onLine: on a link that
      // is up but too slow for Firestore, navigator.onLine is true, so getDocs
      // would stall for its full ~10s timeout before the catch below reached the
      // cache. That is an unacceptable wait with a car sitting at the bay.
      let querySnapshot;
      try {
        querySnapshot = isWorkingOffline ? await getDocsFromCache(q) : await getDocs(q);
      } catch {
        querySnapshot = await getDocsFromCache(q);
      }

      if (!querySnapshot.empty) {
        const found = { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() } as Vehicle;
        setCurrentVehicle(found);
        setIsEditingExisting(false);
        setStep("services");
        // Loyalty lookup runs after the step change so a slow link never holds
        // up the check-in; the badge simply appears when it arrives.
        findCustomer(firestore, found.phoneNumber).then(setCustomer);
      } else {
        newVehicleForm.setValue("licensePlate", data.licensePlate);
        setIsNewVehicleSaved(false);
        setIsEditingExisting(false);
        setCustomer(null);
        setStep("new-vehicle");
      }
    } catch (error) {
        toast({ title: "Error", description: "Could not look up that plate. Register it as a new vehicle to continue.", variant: "destructive" });
    } finally {
        setIsFindingVehicle(false);
    }
  };

  const handleNewVehicleSubmit = async (data: z.infer<typeof newVehicleSchema>) => {
    if (!firestore) return;
    setIsSubmitting(true);
    // Firestore rejects `undefined` field values and does so SYNCHRONOUSLY, before
    // setDoc() ever returns a promise — so a `.catch()` below would not see it and
    // the whole handler would throw. Omit the key entirely when there is no photo.
    const phone = normalizePhone(data.phoneNumber);
    const newVehicle: Omit<Vehicle, 'id'> = {
      licensePlate: data.licensePlate,
      type: data.type,
      make: data.make?.trim() ?? '',
      model: data.model?.trim() ?? '',
      ownerName: data.ownerName?.trim() ?? '',
      phoneNumber: phone,
      whatsappReceiptConsent: !!phone && data.whatsappReceiptConsent,
      ...(vehiclePhotoUri ? { photoDataUri: vehiclePhotoUri } : {}),
    };
    const vehicleRef = doc(firestore, 'vehicles', data.licensePlate);

    // Non-blocking write: Firestore resolves this promise only after the SERVER
    // acknowledges, which never happens offline. We commit to local cache and
    // move on; the SDK replays the write when connectivity returns.
    // merge: editing an existing car only touches the fields on this form.
    setDoc(vehicleRef, newVehicle, { merge: true }).catch(() => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: `vehicles/${data.licensePlate}`,
          operation: isEditingExisting ? 'update' : 'create',
          requestResourceData: newVehicle,
        })
      );
    });

    setCurrentVehicle((prev) => ({ ...(prev ?? {}), id: data.licensePlate, ...newVehicle }));
    setIsNewVehicleSaved(true);
    setIsSubmitting(false);
    findCustomer(firestore, phone).then(setCustomer);
    if (isEditingExisting) {
      toast({ title: "Details updated", description: `${data.licensePlate} has been updated.` });
      setIsEditingExisting(false);
      setStep("services");
      return;
    }
    toast({
      title: "Vehicle Registered",
      description: !isWorkingOffline
        ? `${data.licensePlate} has been saved.`
        : `${data.licensePlate} saved on this device. It will upload when you're back online.`,
    });
  };

  /** Records the arrival. The job is now 'In Progress' until someone completes it. */
  const handleCheckIn = async (data: z.infer<typeof servicesSchema>) => {
    if (!currentVehicle || !user || !firestore || !allServices) return;
    setIsSubmitting(true);

    const selectedServices = allServices.filter(s => data.selectedServices.includes(s.id));
    const totalAmount = selectedServices.reduce((acc, s) => acc + s.price, 0);

    // No `payment` key and no washers yet: both are set at completion. Writing a
    // placeholder payment here would make an unwashed car look like a sale.
    const newJob: Omit<Transaction, 'id'> = {
      timestamp: new Date().toISOString(),
      licensePlate: currentVehicle.licensePlate,
      services: selectedServices.map(s => ({ id: s.id, name: s.name, price: s.price })),
      totalAmount,
      userId: user.uid,
      userName: user.profile?.name || user.email || 'Unknown',
      status: 'In Progress',
      // Optional extras, only written when known (Firestore rejects undefined).
      ...(data.bayNumber?.trim() ? { bayNumber: data.bayNumber.trim() } : {}),
      ...(currentVehicle.make ? { vehicleMake: currentVehicle.make } : {}),
      ...(currentVehicle.model ? { vehicleModel: currentVehicle.model } : {}),
    };

    // Generate the document ID locally rather than letting addDoc round-trip to
    // the server. This is what makes check-in work offline: we write into the
    // local cache and Firestore replays it when the connection comes back.
    const jobRef = doc(collection(firestore, 'transactions'));

    setDoc(jobRef, newJob).catch(() => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: `transactions/${jobRef.id}`,
          operation: 'create',
          requestResourceData: newJob,
        })
      );
      toast({
        title: "Check-In Rejected",
        description: "The server refused this car. Check the console and record it again.",
        variant: "destructive",
      });
    });

    toast({
      title: `${currentVehicle.licensePlate} checked in`,
      description: isWorkingOffline
        ? "Saved on this device. It will upload automatically."
        : "It's now in Cars On Site. Take payment there when the wash is done.",
    });

    startNew();
    setIsSubmitting(false);
  };

  const handlePhotoCaptured = async (imageDataUri: string) => {
    setIsCameraOpen(false);
    if (cameraMode === 'capture') {
        setVehiclePhotoUri(imageDataUri);
        toast({ title: "Photo captured!" });
    } else if (cameraMode === 'scan') {
        setIsScanning(true);
        toast({ title: "Scanning License Plate...", description: "This might take a moment." });
        try {
            const result = await scanPlate({ photoDataUri: imageDataUri });
            if (result && result.licensePlate) {
                vehicleForm.setValue('licensePlate', result.licensePlate);
                toast({
                    title: "Scan Successful!",
                    description: `License plate set to ${result.licensePlate}.`,
                });
            } else {
                toast({
                    variant: "destructive",
                    title: "Scan Failed",
                    description: "Could not read the license plate. Please try again or enter it manually.",
                });
            }
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Scan Error",
                description: "An unexpected error occurred during the scan.",
            });
        } finally {
            setIsScanning(false);
        }
    }
  };

  /** Opens the details form for a car that's already on file. */
  const editCurrentVehicle = () => {
    if (!currentVehicle) return;
    newVehicleForm.reset({
      licensePlate: currentVehicle.licensePlate,
      type: currentVehicle.type || "Sedan",
      make: currentVehicle.make || "",
      model: currentVehicle.model || "",
      ownerName: currentVehicle.ownerName || "",
      phoneNumber: currentVehicle.phoneNumber || "",
      whatsappReceiptConsent: !!currentVehicle.whatsappReceiptConsent,
    });
    setVehiclePhotoUri(currentVehicle.photoDataUri || null);
    setIsNewVehicleSaved(false);
    setIsEditingExisting(true);
    setStep("new-vehicle");
  };

  const startNew = () => {
    vehicleForm.reset({ licensePlate: "" });
    newVehicleForm.reset({ licensePlate: "", type: "Sedan", make: "", model: "", ownerName: "", phoneNumber: "", whatsappReceiptConsent: false });
    servicesForm.reset({ selectedServices: [], bayNumber: "" });
    setCurrentVehicle(null);
    setCustomer(null);
    setIsEditingExisting(false);
    setVehiclePhotoUri(null);
    setIsNewVehicleSaved(false);
    setStep("vehicle");
  };

  const motionProps = {
    initial: { opacity: 0, x: 50 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -50 },
    transition: { duration: 0.3 }
  };

  const renderStep = () => {
    switch (step) {
      case "vehicle":
        return (
          <motion.div {...motionProps}>
          <Card>
            <CardHeader>
              <CardTitle>1. Vehicle Identification</CardTitle>
              <CardDescription>Enter the vehicle&apos;s license plate or scan it.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...vehicleForm}>
                <form onSubmit={vehicleForm.handleSubmit(handleVehicleSubmit)} className="space-y-4">
                  <FormField
                    control={vehicleForm.control}
                    name="licensePlate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>License Plate</FormLabel>
                        <div className="relative">
                            <FormControl>
                            <Input placeholder="e.g., ABC 1234" {...field} />
                            </FormControl>
                            <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1 h-8 w-8"
                            onClick={() => {
                                setCameraMode('scan');
                                setIsCameraOpen(true);
                            }}
                            disabled={isScanning}
                            >
                            {isScanning ? <Loader2 className="animate-spin" /> : <Camera className="size-5" />}
                            <span className="sr-only">Scan License Plate</span>
                            </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={isScanning || isFindingVehicle || isLoadingServices}>
                    {isFindingVehicle && <Loader2 className="animate-spin mr-2" />}
                    {isFindingVehicle ? 'Finding...' : 'Find Vehicle'}
                     <ChevronRight className="ml-2" />
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
          </motion.div>
        );
      case "new-vehicle":
        return (
            <motion.div {...motionProps}>
            <Card>
            <CardHeader>
              <CardTitle>{isEditingExisting ? "Update Vehicle Details" : "Register New Vehicle"}</CardTitle>
              <CardDescription>{isEditingExisting ? "Fix or fill in this car's details. The phone number is what links it to loyalty points and WhatsApp receipts." : "This license plate is not in our system. Please add the vehicle details."}</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...newVehicleForm}>
                <form onSubmit={newVehicleForm.handleSubmit(handleNewVehicleSubmit)} className="space-y-4">
                   <div className="space-y-2">
                      <FormLabel>Vehicle Photo</FormLabel>
                      <Card>
                          <CardContent className="p-2">
                              <div className="aspect-video w-full bg-muted rounded-md flex items-center justify-center overflow-hidden">
                                  {vehiclePhotoUri ? (
                                      <img src={vehiclePhotoUri} alt="Vehicle" className="h-full w-full object-cover rounded-md" />
                                  ) : (
                                      <ImageIcon className="size-12 text-muted-foreground" />
                                  )}
                              </div>
                          </CardContent>
                          <CardFooter className="p-2 pt-0">
                              <Button type="button" variant="outline" className="w-full" onClick={() => {
                                  setCameraMode('capture');
                                  setIsCameraOpen(true);
                              }}
                              disabled={isSubmitting || isNewVehicleSaved}>
                                  <Camera className="mr-2" /> {vehiclePhotoUri ? 'Retake' : 'Capture'} Photo
                              </Button>
                          </CardFooter>
                      </Card>
                  </div>

                  <FormField control={newVehicleForm.control} name="licensePlate" render={({ field }) => (
                    <FormItem><FormLabel>License Plate</FormLabel><FormControl><Input {...field} disabled /></FormControl><FormMessage /></FormItem>
                  )}/>
                  <FormField control={newVehicleForm.control} name="type" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vehicle Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isSubmitting || isNewVehicleSaved}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select vehicle type" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="Sedan">Sedan</SelectItem>
                          <SelectItem value="SUV">SUV</SelectItem>
                          <SelectItem value="Truck">Truck</SelectItem>
                          <SelectItem value="Minibus">Minibus</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}/>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={newVehicleForm.control} name="make" render={({ field }) => (
                      <FormItem><FormLabel>Make (Optional)</FormLabel><FormControl><Input placeholder="Toyota" {...field} disabled={isSubmitting || isNewVehicleSaved}/></FormControl><FormMessage /></FormItem>
                    )}/>
                    <FormField control={newVehicleForm.control} name="model" render={({ field }) => (
                      <FormItem><FormLabel>Model (Optional)</FormLabel><FormControl><Input placeholder="Corolla" {...field} disabled={isSubmitting || isNewVehicleSaved}/></FormControl><FormMessage /></FormItem>
                    )}/>
                  </div>
                  <FormField control={newVehicleForm.control} name="ownerName" render={({ field }) => (
                    <FormItem><FormLabel>Owner Name (Optional)</FormLabel><FormControl><Input placeholder="John Doe" {...field} disabled={isSubmitting || isNewVehicleSaved}/></FormControl><FormMessage /></FormItem>
                  )}/>
                   <FormField control={newVehicleForm.control} name="phoneNumber" render={({ field }) => (
                    <FormItem><FormLabel>Phone Number (for WhatsApp &amp; loyalty points)</FormLabel><FormControl><Input inputMode="tel" placeholder="0977 123 456" {...field} disabled={isSubmitting || isNewVehicleSaved} /></FormControl><FormMessage /></FormItem>
                  )}/>
                  <FormField control={newVehicleForm.control} name="whatsappReceiptConsent" render={({ field }) => (
                    <FormItem className="flex flex-row items-start gap-3 space-y-0 rounded-md border p-3">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} disabled={isSubmitting || isNewVehicleSaved} />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="font-normal">Customer agrees to get receipts on WhatsApp</FormLabel>
                        <p className="text-xs text-muted-foreground">Ask them first. Without this, receipts are only sent when you tap Send on WhatsApp.</p>
                      </div>
                    </FormItem>
                  )}/>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => { setStep(isEditingExisting ? "services" : "vehicle"); setIsEditingExisting(false); }} disabled={isSubmitting || isNewVehicleSaved}>
                      <ChevronLeft className="mr-2" />Back
                    </Button>
                    {!isNewVehicleSaved ? (
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="mr-2 animate-spin" />}
                            {isEditingExisting ? "Save Details" : "Register Vehicle"}
                        </Button>
                    ) : (
                        <Button type="button" onClick={() => setStep("services")}>
                            Continue to Services <ChevronRight className="ml-2" />
                        </Button>
                    )}
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
          </motion.div>
        );
      case "services": {
        const selectedIds = servicesForm.watch("selectedServices");
        const selected = allServices?.filter(s => selectedIds.includes(s.id)) || [];
        const total = selected.reduce((acc, s) => acc + s.price, 0);

        return (
            <motion.div {...motionProps} className="grid md:grid-cols-3 gap-6">
                <div className="md:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>2. What is being done?</CardTitle>
                            <CardDescription>
                                Select the work for {currentVehicle?.licensePlate}. You can still change
                                this when you take payment.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                        {currentVehicle && (
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
                                <div className="min-w-0">
                                    <p className="font-semibold">
                                        {currentVehicle.licensePlate}
                                        <span className="ml-2 font-normal text-muted-foreground">
                                            {[currentVehicle.make, currentVehicle.model].filter(Boolean).join(" ") || currentVehicle.type}
                                        </span>
                                    </p>
                                    <p className="truncate text-xs text-muted-foreground">
                                        {currentVehicle.ownerName || "No owner name"} · {currentVehicle.phoneNumber || "no phone number"}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {customer ? (
                                        <Badge variant="outline" className={tierStyles[calcTier(customer.totalPoints)]}>
                                            <Trophy className="mr-1 h-3 w-3" />
                                            {calcTier(customer.totalPoints)} · {customer.totalPoints} pts · {customer.totalVisits} visits
                                        </Badge>
                                    ) : currentVehicle.phoneNumber ? (
                                        <Badge variant="outline">First visit for loyalty</Badge>
                                    ) : null}
                                    <Button type="button" size="sm" variant="ghost" onClick={editCurrentVehicle}>
                                        <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                                    </Button>
                                </div>
                            </div>
                        )}
                        <Form {...servicesForm}>
                            <form onSubmit={servicesForm.handleSubmit(handleCheckIn)} className="space-y-4">
                                <FormField control={servicesForm.control} name="bayNumber" render={({ field }) => (
                                    <FormItem className="max-w-[200px]">
                                        <FormLabel>Bay (Optional)</FormLabel>
                                        <FormControl><Input placeholder="e.g. 2" {...field} /></FormControl>
                                    </FormItem>
                                )}/>
                                <FormField control={servicesForm.control} name="selectedServices" render={() => (
                                    <FormItem className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {isLoadingServices && <>
                                          <Skeleton className="h-24 w-full" />
                                          <Skeleton className="h-24 w-full" />
                                        </>}
                                        {allServices?.map((service) => (
                                        <FormField key={service.id} control={servicesForm.control} name="selectedServices" render={({ field }) => (
                                            <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                                            <Card className={`w-full cursor-pointer hover:border-primary transition-colors ${field.value?.includes(service.id) ? "border-primary border-2" : ""}`}>
                                                <CardContent className="p-4">
                                                    <FormControl>
                                                        <Checkbox className="hidden" checked={field.value?.includes(service.id)} onCheckedChange={(checked) => {
                                                            return checked ? field.onChange([...field.value, service.id]) : field.onChange(field.value?.filter((value) => value !== service.id));
                                                        }} />
                                                    </FormControl>
                                                    <FormLabel className="font-normal w-full flex items-center justify-between cursor-pointer">
                                                        <div className="flex items-center gap-3">
                                                            {serviceIcons[service.name] || <Car className="h-6 w-6 text-primary" />}
                                                            <span className="text-lg font-medium">{service.name}</span>
                                                        </div>
                                                        <span className="text-lg font-bold">{formatCurrency(service.price)}</span>
                                                    </FormLabel>
                                                </CardContent>
                                            </Card>
                                            </FormItem>
                                        )} />
                                    ))}
                                    <FormMessage className="col-span-full" />
                                </FormItem>
                                )}/>
                            </form>
                        </Form>
                        </CardContent>
                    </Card>
                </div>
                <div className="md:col-span-1">
                    <Card className="sticky top-20">
                        <CardHeader><CardTitle>Order Summary</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            {selected.length > 0 ? selected.map(s => (
                                <div key={s.id} className="flex justify-between"><span>{s.name}</span><span className="font-medium">{formatCurrency(s.price)}</span></div>
                            )) : <p className="text-muted-foreground">No services selected.</p>}
                            <Separator />
                            <div className="flex justify-between text-xl font-bold"><span>Total</span><span>{formatCurrency(total)}</span></div>
                            {isWorkingOffline && (
                                <Alert className="border-amber-500/40 bg-amber-500/5">
                                    <CloudOff className="h-4 w-4 text-amber-600" />
                                    <AlertTitle className="text-amber-700">Working offline</AlertTitle>
                                    <AlertDescription className="text-amber-700/90 text-xs">
                                        Carry on as normal. This check-in is saved to the tablet and
                                        uploads by itself when signal returns.
                                    </AlertDescription>
                                </Alert>
                            )}
                        </CardContent>
                        <CardFooter className="flex flex-col gap-2">
                            <Button
                                className="w-full"
                                onClick={servicesForm.handleSubmit(handleCheckIn)}
                                disabled={selected.length === 0 || isSubmitting}
                            >
                                {isSubmitting && <Loader2 className="animate-spin mr-2" />}
                                <Check className="mr-2" /> Check In Car
                            </Button>
                            <Button className="w-full" variant="outline" type="button" onClick={startNew}>
                                <ChevronLeft className="mr-2" />Cancel
                            </Button>
                        </CardFooter>
                    </Card>
                </div>
            </motion.div>
        );
      }
    }
  };

  return (
    <>
      <AnimatePresence mode="wait">{renderStep()}</AnimatePresence>
      <AnimatePresence>
      {isCameraOpen && (
        <VehicleCamera
          onCapture={handlePhotoCaptured}
          onClose={() => setIsCameraOpen(false)}
        />
      )}
      </AnimatePresence>
    </>
  );
}
