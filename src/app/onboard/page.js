'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Store, 
  Phone, 
  MapPin, 
  Upload, 
  FileText, 
  Image as ImageIcon, 
  X, 
  CheckCircle2, 
  Search, 
  Loader2, 
  ArrowLeft,
  Sparkles,
  Share2
} from 'lucide-react';
import Link from 'next/link';
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps';

export default function OnboardPage() {
  const router = useRouter();

  // Form Fields
  const [restaurantName, setRestaurantName] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  
  // Location States
  const [locationInput, setLocationInput] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null); // { formattedAddress, latitude, longitude, placeId }
  const [showDropdown, setShowDropdown] = useState(false);
  const [addressText, setAddressText] = useState('');
  const [mapCenter, setMapCenter] = useState({ lat: 28.6139, lng: 77.2090 });
  const [mapZoom, setMapZoom] = useState(12);
  const [gpsDetecting, setGpsDetecting] = useState(false);
  
  // Modal Popup Location States
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [tempSelectedLocation, setTempSelectedLocation] = useState(null);
  const [tempAddressText, setTempAddressText] = useState('');
  const [modalErrorMessage, setModalErrorMessage] = useState('');

  // Cuisines (Optional)
  const cuisineOptions = ['North Indian', 'Chinese', 'South Indian', 'Fast Food', 'Cafe'];
  const [selectedCuisines, setSelectedCuisines] = useState([]);

  // Referral Source (Optional)
  const referralOptions = [
    { value: 'Instagram', label: 'Instagram' },
    { value: 'Facebook', label: 'Facebook' },
    { value: 'Friend', label: 'Friend / Referral' },
    { value: 'YouTube', label: 'YouTube' },
    { value: 'Google', label: 'Google Search' },
    { value: 'Other', label: 'Other' }
  ];
  const [referralSource, setReferralSource] = useState('Instagram');

  // Files
  const [stagedFiles, setStagedFiles] = useState([]); // Array of File objects
  const fileInputRef = useRef(null);

  // UI States
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);

  // Dropdown Reference for closing on click outside
  const dropdownRef = useRef(null);

  // Debounced search for Google Places Autocomplete
  useEffect(() => {
    if (!locationInput.trim()) {
      setSuggestions([]);
      return;
    }

    const delayDebounce = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const res = await fetch(`/api/public/location/search?query=${encodeURIComponent(locationInput)}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data || []);
        } else {
          setSuggestions([]);
        }
      } catch (err) {
        console.error('Error fetching location suggestions:', err);
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [locationInput, selectedLocation]);

  // Close suggestions dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleOpenMapModal = () => {
    setModalErrorMessage('');
    if (selectedLocation) {
      setTempSelectedLocation(selectedLocation);
      setTempAddressText(addressText);
      setMapCenter({ lat: selectedLocation.latitude, lng: selectedLocation.longitude });
      setMapZoom(16);
    } else {
      setTempSelectedLocation(null);
      setTempAddressText('');
      setMapZoom(12);
      setMapCenter({ lat: 28.6139, lng: 77.2090 });
      // Centering map at current location on opening if available
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            setMapCenter({ lat, lng });
            setMapZoom(15);
          },
          () => {},
          { timeout: 4000 }
        );
      }
    }
    setLocationInput('');
    setSuggestions([]);
    setIsMapModalOpen(true);
  };

  const handleConfirmLocation = () => {
    if (!tempSelectedLocation || !tempSelectedLocation.latitude || !tempSelectedLocation.longitude) {
      setModalErrorMessage('Please pinpoint your location on the map before confirming.');
      return;
    }
    if (!tempAddressText.trim()) {
      setModalErrorMessage('Please verify or enter the address text before confirming.');
      return;
    }
    setSelectedLocation({
      ...tempSelectedLocation,
      formattedAddress: tempAddressText.trim()
    });
    setAddressText(tempAddressText.trim());
    setModalErrorMessage('');
    setIsMapModalOpen(false);
  };

  const handleCancelLocation = () => {
    setTempSelectedLocation(null);
    setTempAddressText('');
    setModalErrorMessage('');
    setIsMapModalOpen(false);
  };

  const handleSelectLocation = (suggestion) => {
    const address = `${suggestion.placeName}, ${suggestion.placeAddress}`;
    setTempSelectedLocation({
      formattedAddress: address,
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      placeId: suggestion.eLoc
    });
    setMapCenter({ lat: suggestion.latitude, lng: suggestion.longitude });
    setMapZoom(16);
    setTempAddressText(address);
    setLocationInput('');
    setSuggestions([]);
    setShowDropdown(false);
  };

  const handleMapClick = async (event) => {
    if (!event.detail.latLng) return;
    const { lat, lng } = event.detail.latLng;
    
    setTempSelectedLocation((prev) => ({
      formattedAddress: prev?.formattedAddress || 'Pinpointed Location',
      latitude: lat,
      longitude: lng,
      placeId: prev?.placeId || 'manual_click'
    }));

    setIsGeocoding(true);
    try {
      const res = await fetch(`/api/public/location/geocode?lat=${lat}&lng=${lng}`);
      if (res.ok) {
        const data = await res.json();
        const addr = data.formatted_address || 'Pinpointed Location';
        setTempAddressText(addr);
        setTempSelectedLocation({
          formattedAddress: addr,
          latitude: lat,
          longitude: lng,
          placeId: 'manual_click'
        });
      } else {
        setTempAddressText(`Pinpointed at (${lat.toFixed(6)}, ${lng.toFixed(6)})`);
      }
    } catch (err) {
      console.error('Reverse geocoding error:', err);
      setTempAddressText(`Pinpointed at (${lat.toFixed(6)}, ${lng.toFixed(6)})`);
    } finally {
      setIsGeocoding(false);
    }
  };

  const detectLocation = () => {
    if (!navigator.geolocation) {
      setModalErrorMessage('Geolocation is not supported by your browser.');
      return;
    }

    setGpsDetecting(true);
    setModalErrorMessage('');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        
        setMapCenter({ lat, lng });
        setMapZoom(16);
        
        setTempSelectedLocation({
          formattedAddress: 'Pinpointed Location',
          latitude: lat,
          longitude: lng,
          placeId: 'gps_detection'
        });

        setIsGeocoding(true);
        try {
          const res = await fetch(`/api/public/location/geocode?lat=${lat}&lng=${lng}`);
          if (res.ok) {
            const data = await res.json();
            const addr = data.formatted_address || 'Pinpointed Location';
            setTempAddressText(addr);
            setTempSelectedLocation({
              formattedAddress: addr,
              latitude: lat,
              longitude: lng,
              placeId: 'gps_detection'
            });
          } else {
            setTempAddressText(`Pinpointed at (${lat.toFixed(6)}, ${lng.toFixed(6)})`);
          }
        } catch (err) {
          console.error('Reverse geocoding error:', err);
          setTempAddressText(`Pinpointed at (${lat.toFixed(6)}, ${lng.toFixed(6)})`);
        } finally {
          setIsGeocoding(false);
          setGpsDetecting(false);
        }
      },
      (error) => {
        console.warn('GPS detection error:', error);
        setModalErrorMessage('Failed to detect your location. Please select it on the map or search manually.');
        setGpsDetecting(false);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  };

  const handleClearLocation = () => {
    setSelectedLocation(null);
    setAddressText('');
    setTempSelectedLocation(null);
    setTempAddressText('');
    setLocationInput('');
    setMapZoom(12);
    setMapCenter({ lat: 28.6139, lng: 77.2090 });
  };

  const handleCuisineToggle = (cuisine) => {
    if (selectedCuisines.includes(cuisine)) {
      setSelectedCuisines(selectedCuisines.filter(c => c !== cuisine));
    } else {
      setSelectedCuisines([...selectedCuisines, cuisine]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      setStagedFiles((prev) => [...prev, ...filesArray]);
    }
  };

  const handleRemoveFile = (index) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    // Validations
    if (!restaurantName.trim()) {
      setErrorMessage('Restaurant name is required.');
      return;
    }
    if (!whatsappNumber.trim() || whatsappNumber.length < 10) {
      setErrorMessage('A valid 10-digit WhatsApp number is required.');
      return;
    }
    if (!selectedLocation || !selectedLocation.latitude || !selectedLocation.longitude) {
      setErrorMessage('Please pinpoint your restaurant location on the Google Map.');
      return;
    }
    if (!addressText.trim()) {
      setErrorMessage('Please verify or enter your restaurant address.');
      return;
    }
    if (stagedFiles.length === 0) {
      setErrorMessage('Please upload at least one menu photo or PDF.');
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Upload assets via Onboard-Upload API
      const uploadFormData = new FormData();
      stagedFiles.forEach((file) => {
        uploadFormData.append('files', file);
      });

      const uploadRes = await fetch('/api/public/onboard-upload', {
        method: 'POST',
        body: uploadFormData
      });

      if (!uploadRes.ok) {
        const errData = await uploadRes.json();
        throw new Error(errData.message || 'Failed to upload menu files.');
      }

      const { urls } = await uploadRes.json();

      // 2. Submit request details
      const requestPayload = {
        restaurantName,
        whatsappNumber,
        location: {
          formattedAddress: addressText.trim(),
          latitude: selectedLocation.latitude,
          longitude: selectedLocation.longitude,
          placeId: selectedLocation.placeId || 'manual_pinpoint'
        },
        cuisines: selectedCuisines,
        referralSource,
        menuUrls: urls
      };

      const submitRes = await fetch('/api/public/onboard-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload)
      });

      if (!submitRes.ok) {
        const errData = await submitRes.json();
        throw new Error(errData.message || 'Failed to submit onboarding request.');
      }

      setSubmitSuccess(true);

    } catch (err) {
      setErrorMessage(err.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0A0A0C] text-slate-800 dark:text-[#FAFAFA] font-sans pb-24 transition-colors duration-300">
      {/* Navigation Header */}
      <div className="max-w-4xl mx-auto px-4 pt-8 pb-4">
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-primary dark:text-neutral-400 dark:hover:text-primary transition-all"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>
      </div>

      {/* Main Container */}
      <div className="max-w-2xl mx-auto px-4 mt-4">
        {submitSuccess ? (
          /* SUCCESS STATE */
          <div className="bg-white dark:bg-[#121216] border border-slate-200 dark:border-[#1F1F27]/80 rounded-3xl p-8 md:p-12 text-center shadow-xl shadow-primary/5 transition-all">
            <div className="w-20 h-20 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6 border border-green-500/20">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight mb-4">Registration Successful!</h1>
            <p className="text-slate-500 dark:text-neutral-400 leading-relaxed mb-8 text-base md:text-lg">
              Bhai, aapka application successfully submit ho gaya hai! Hamari team aapke menu photo/PDF ko review karegi aur <strong>2 se 4 ghante</strong> me restaurant ko platform par live kar degi.
            </p>
            <div className="bg-slate-50 dark:bg-[#1A1A22] rounded-2xl p-6 text-left border border-slate-100 dark:border-neutral-800/40 mb-8 max-w-md mx-auto">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">Onboarding Details</h3>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Outlet Name:</span>
                  <span className="font-semibold text-foreground">{restaurantName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">WhatsApp:</span>
                  <span className="font-semibold text-foreground">{whatsappNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Status:</span>
                  <span className="font-bold text-amber-500">Pending Review</span>
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-8">
              Aapke live hone par aapke WhatsApp number par trigger notification send kar diya jayega.
            </p>
            <button
              onClick={() => router.push('/')}
              className="px-8 py-3.5 bg-primary text-primary-foreground font-black rounded-xl hover:bg-primary/95 transition-all shadow-lg shadow-primary/20 active:scale-95"
            >
              Back to Homepage
            </button>
          </div>
        ) : (
          /* FORM STATE */
          <div className="bg-white dark:bg-[#121216] border border-slate-200 dark:border-[#1F1F27]/80 rounded-3xl shadow-xl shadow-primary/5 p-6 md:p-10">
            <div className="mb-8 flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Store className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" /> For Restaurant Owners
                </span>
                <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-0.5">List Your Restaurant</h1>
              </div>
            </div>

            {errorMessage && (
              <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-sm rounded-xl font-medium flex items-center gap-2">
                <X className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* 1. Restaurant Name */}
              <div>
                <label className="block text-sm font-bold mb-2 text-slate-600 dark:text-neutral-300">
                  Restaurant Name <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Store className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. UP14 Food Point"
                    value={restaurantName}
                    onChange={(e) => setRestaurantName(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-[#1A1A22] border border-slate-200 dark:border-[#2a2a35] focus:border-primary focus:ring-1 focus:ring-primary rounded-xl text-sm focus:outline-none transition-all text-foreground"
                  />
                </div>
              </div>

              {/* 2. WhatsApp Number */}
              <div>
                <label className="block text-sm font-bold mb-2 text-slate-600 dark:text-neutral-300">
                  WhatsApp Number <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="tel"
                    required
                    pattern="[0-9]{10}"
                    maxLength="10"
                    placeholder="e.g. 9876543210"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value.replace(/\D/g, ''))}
                    className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-[#1A1A22] border border-slate-200 dark:border-[#2a2a35] focus:border-primary focus:ring-1 focus:ring-primary rounded-xl text-sm focus:outline-none transition-all text-foreground"
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  OTP verification is not required right now. Double check the number.
                </p>
              </div>

              {/* 3. Google Maps Location */}
              <div className="space-y-3">
                <label className="block text-sm font-bold text-slate-600 dark:text-neutral-300">
                  Google Maps Location <span className="text-rose-500">*</span>
                </label>
                
                {!selectedLocation ? (
                  <button
                    type="button"
                    onClick={handleOpenMapModal}
                    className="w-full py-6 border-2 border-dashed border-slate-200 dark:border-[#2a2a35] hover:border-primary dark:hover:border-primary rounded-2xl flex flex-col items-center justify-center gap-2 bg-slate-50/50 hover:bg-slate-50 dark:bg-[#1A1A22]/30 dark:hover:bg-[#1A1A22]/60 transition-all active:scale-[0.99] group shadow-inner"
                  >
                    <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                      📍
                    </div>
                    <span className="text-sm font-bold text-foreground">Select Location on Google Maps</span>
                    <span className="text-xs text-slate-400">Map par coordinate pin select karne ke liye click karein</span>
                  </button>
                ) : (
                  <div className="p-5 rounded-2xl border border-slate-200 dark:border-[#1F1F27]/80 bg-slate-50/50 dark:bg-[#15151A] flex flex-col gap-4 shadow-sm relative group">
                    <div className="flex items-start gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <MapPin className="w-5 h-5" />
                      </div>
                      <div className="flex-grow overflow-hidden">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Selected Address</h4>
                        <p className="text-sm font-semibold text-slate-800 dark:text-neutral-200 mt-1 leading-relaxed break-words">
                          {addressText}
                        </p>
                        <div className="mt-2 flex items-center gap-4 text-[10px] font-mono text-slate-400">
                          <span>Lat: {selectedLocation.latitude.toFixed(6)}</span>
                          <span>Lng: {selectedLocation.longitude.toFixed(6)}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex gap-2 border-t border-slate-100 dark:border-neutral-800/40 pt-3 mt-1">
                      <button
                        type="button"
                        onClick={handleOpenMapModal}
                        className="flex-1 py-2 px-3 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold rounded-lg transition-all text-center"
                      >
                        Change Location
                      </button>
                      <button
                        type="button"
                        onClick={handleClearLocation}
                        className="py-2 px-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-xs font-bold rounded-lg transition-all text-center"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. Cuisine Type (Optional Checkboxes) */}
              <div>
                <label className="block text-sm font-bold mb-3 text-slate-600 dark:text-neutral-300">
                  Cuisine Types <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {cuisineOptions.map((cuisine) => {
                    const checked = selectedCuisines.includes(cuisine);
                    return (
                      <button
                        key={cuisine}
                        type="button"
                        onClick={() => handleCuisineToggle(cuisine)}
                        className={`px-4 py-3 rounded-xl border text-xs font-semibold text-left transition-all flex items-center justify-between ${
                          checked
                            ? 'bg-primary/5 text-primary border-primary font-bold dark:bg-primary/10'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 dark:bg-[#1A1A22] dark:border-[#2a2a35] dark:text-neutral-400 dark:hover:border-neutral-700'
                        }`}
                      >
                        <span>{cuisine}</span>
                        {checked && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 5. Referral Source (Optional Select) */}
              <div>
                <label className="block text-sm font-bold mb-2 text-slate-600 dark:text-neutral-300">
                  Where did you hear about us? <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                </label>
                <div className="relative">
                  <Share2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <select
                    value={referralSource}
                    onChange={(e) => setReferralSource(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-[#1A1A22] border border-slate-200 dark:border-[#2a2a35] focus:border-primary focus:ring-1 focus:ring-primary rounded-xl text-sm focus:outline-none transition-all text-foreground appearance-none"
                  >
                    {referralOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 6. Menu Upload */}
              <div>
                <label className="block text-sm font-bold mb-2 text-slate-600 dark:text-neutral-300">
                  Upload Menu Photos / PDF <span className="text-rose-500">*</span>
                </label>
                
                {/* Drag and Drop Zone */}
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 hover:border-primary dark:border-[#2a2a35] dark:hover:border-primary rounded-2xl p-8 text-center cursor-pointer transition-all bg-slate-50/50 hover:bg-slate-50 dark:bg-[#1A1A22]/30 dark:hover:bg-[#1A1A22]/60"
                >
                  <Upload className="w-8 h-8 text-slate-400 dark:text-neutral-500 mx-auto mb-3" />
                  <p className="text-sm font-bold">Drag and drop files here, or click to browse</p>
                  <p className="text-xs text-slate-400 mt-1">Supports PDF, JPG, JPEG, and PNG images</p>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    multiple
                    accept=".pdf,image/*"
                    className="hidden"
                  />
                </div>

                {/* Staged Files List */}
                {stagedFiles.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Staged Files ({stagedFiles.length})</p>
                    {stagedFiles.map((file, index) => {
                      const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');
                      return (
                        <div 
                          key={index} 
                          className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#1A1A22] border border-slate-100 dark:border-neutral-800/40 rounded-xl"
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            {isPdf ? (
                              <FileText className="w-5 h-5 text-red-500 shrink-0" />
                            ) : (
                              <ImageIcon className="w-5 h-5 text-blue-500 shrink-0" />
                            )}
                            <span className="text-sm truncate font-medium max-w-sm">{file.name}</span>
                            <span className="text-[10px] text-slate-400 shrink-0">
                              ({(file.size / 1024 / 1024).toFixed(2)} MB)
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(index)}
                            className="p-1 text-slate-400 hover:text-rose-500 dark:text-neutral-500 dark:hover:text-rose-500 rounded-lg hover:bg-slate-100 dark:hover:bg-neutral-800 transition-all"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-4 bg-primary text-primary-foreground font-black rounded-xl hover:bg-primary/95 transition-all shadow-xl shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-50 active:scale-98 mt-8 text-base"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> Submitting Request...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5" /> Submit Onboarding Request
                  </>
                )}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Google Maps Selection Popup Modal */}
      {isMapModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
          {/* Modal Card */}
          <div 
            className="bg-white dark:bg-[#121216] border border-slate-200 dark:border-[#1F1F27]/80 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-[#1F1F27]/50 flex items-center justify-between bg-slate-50/50 dark:bg-[#15151A]">
              <div>
                <h3 className="text-lg font-black text-foreground">Select Restaurant Location</h3>
                <p className="text-xs text-slate-400 mt-0.5">Drop a pin on the map and verify the address</p>
              </div>
              <button
                type="button"
                onClick={handleCancelLocation}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-neutral-800 rounded-lg text-slate-400 hover:text-slate-600 dark:text-neutral-500 dark:hover:text-neutral-300 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {modalErrorMessage && (
                <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs rounded-xl font-medium flex items-center gap-2">
                  <X className="w-4 h-4 shrink-0" />
                  <span>{modalErrorMessage}</span>
                </div>
              )}

              {/* Search Bar + GPS Button */}
              <div ref={dropdownRef} className="space-y-1 relative">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Search Location / Area
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-grow">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Type city, sector, area name..."
                      value={locationInput}
                      onChange={(e) => {
                        setLocationInput(e.target.value);
                        setShowDropdown(true);
                      }}
                      onFocus={() => setShowDropdown(true)}
                      className="w-full pl-10 pr-10 py-2.5 bg-slate-50 dark:bg-[#1A1A22] border border-slate-200 dark:border-[#2a2a35] focus:border-primary focus:ring-1 focus:ring-primary rounded-xl text-sm focus:outline-none transition-all text-foreground"
                    />
                    {loadingSuggestions && (
                      <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />
                    )}

                    {/* Suggestions Dropdown */}
                    {showDropdown && suggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-0 z-55 mt-1 bg-white dark:bg-[#121216] border border-slate-200 dark:border-[#1F1F27]/80 rounded-xl shadow-2xl overflow-hidden max-h-52 overflow-y-auto">
                        {suggestions.map((s) => (
                          <button
                            key={s.eLoc}
                            type="button"
                            onClick={() => handleSelectLocation(s)}
                            className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-[#1A1A22] border-b border-slate-100 dark:border-[#1F1F27]/30 last:border-b-0 flex items-start gap-2.5 transition-all"
                          >
                            <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                            <div>
                              <p className="text-xs font-semibold text-foreground">{s.placeName}</p>
                              <p className="text-[10px] text-slate-400 mt-0.5 truncate max-w-sm">{s.placeAddress}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={detectLocation}
                    disabled={gpsDetecting}
                    className="px-4 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-xs shrink-0 shadow-lg shadow-primary/15 disabled:opacity-50 active:scale-95"
                  >
                    {gpsDetecting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <MapPin className="w-4 h-4" />
                        <span>GPS Detect</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Map */}
              <div className="h-64 w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-[#2a2a35] relative shadow-inner">
                {isGeocoding && (
                  <div className="absolute inset-0 bg-black/40 z-20 flex items-center justify-center backdrop-blur-[1px] transition-all">
                    <div className="bg-[#121216]/95 border border-[#1f1f27] px-3.5 py-2 rounded-xl flex items-center gap-2 text-xs font-bold text-white shadow-xl animate-pulse">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      Pinpointing address...
                    </div>
                  </div>
                )}
                
                {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? (
                  <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY} libraries={['marker']}>
                    <Map
                      mapId="onboard_restaurant_map_popup"
                      style={{ width: '100%', height: '100%' }}
                      center={mapCenter}
                      zoom={mapZoom}
                      gestureHandling="greedy"
                      onClick={handleMapClick}
                      options={{
                        zoomControl: true,
                        streetViewControl: false,
                        mapTypeControl: false,
                        fullscreenControl: false,
                      }}
                    >
                      {tempSelectedLocation && (
                        <AdvancedMarker
                          position={{ lat: tempSelectedLocation.latitude, lng: tempSelectedLocation.longitude }}
                          title={restaurantName || "My Restaurant"}
                        >
                          <div className="w-8 h-8 rounded-full bg-primary border-2 border-white flex items-center justify-center shadow-lg text-base animate-bounce select-none">
                            📍
                          </div>
                        </AdvancedMarker>
                      )}
                    </Map>
                  </APIProvider>
                ) : (
                  <div className="w-full h-full bg-slate-100 dark:bg-[#1A1A22] flex items-center justify-center">
                    <p className="text-xs text-rose-500 font-bold">Google Maps API key is not configured.</p>
                  </div>
                )}
              </div>

              {/* Editable Address Text */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 dark:text-neutral-400 uppercase tracking-wider">
                  Verify & Edit Restaurant Address (Type details like shop number, floor, etc. manually)
                </label>
                <textarea
                  rows={3}
                  placeholder="Map par place pinpoint karein ya select karein. Phir address yahan automatically fill hoga jise aap change kar sakte hain."
                  value={tempAddressText}
                  onChange={(e) => setTempAddressText(e.target.value)}
                  className="w-full p-3 bg-slate-50 dark:bg-[#1A1A22] border border-slate-200 dark:border-[#2a2a35] focus:border-primary focus:ring-1 focus:ring-primary rounded-xl text-sm focus:outline-none transition-all text-foreground resize-none"
                />
                {tempSelectedLocation && (
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 px-1">
                    <span>Latitude: {tempSelectedLocation.latitude.toFixed(6)}</span>
                    <span>Longitude: {tempSelectedLocation.longitude.toFixed(6)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 dark:border-[#1F1F27]/50 bg-slate-50/50 dark:bg-[#15151A] flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleCancelLocation}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-700 dark:text-neutral-200 font-bold text-sm rounded-xl transition-all active:scale-95"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmLocation}
                className="px-5 py-2.5 bg-primary hover:bg-primary/95 text-primary-foreground font-black text-sm rounded-xl transition-all shadow-lg shadow-primary/20 active:scale-95"
              >
                Confirm Location
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
