import { useState } from "react";
import { FaMapMarkerAlt, FaLocationArrow, FaSearch } from "react-icons/fa";
import "./Filter.css";

function Filter() {
  const [location, setLocation] = useState("Detecting...");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);

  // 🧭 Fetch user current location (city/colony only)
  const detectLocation = () => {
    if (navigator.geolocation) {
      setLoading(true);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          try {
            const res = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
            );
            const data = await res.json();
            const addr = data.address;
            // Prefer smaller area names, fallback to city or state
            const loc =
              addr.suburb ||
              addr.neighbourhood ||
              addr.village ||
              addr.town ||
              addr.city ||
              addr.state ||
              "Unknown";
            setLocation(loc);
          } catch (err) {
            setLocation("Unable to fetch location");
          }
          setLoading(false);
        },
        () => {
          setLocation("Location access denied");
          setLoading(false);
        }
      );
    } else {
      setLocation("Geolocation not supported");
    }
  };

  // 🧭 Manual search (filter clean names)
  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length > 2) {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${query}`
      );
      const data = await res.json();

      // 🧠 Clean and extract readable city/colony names
      const cleanResults = data
        .map((place) => {
          const displayName = place.display_name
            .split(",") // split parts
            .slice(0, 2) // keep first two parts (colony + city)
            .join(","); // rejoin
          return { ...place, shortName: displayName };
        })
        .slice(0, 5);

      setSearchResults(cleanResults);
    } else {
      setSearchResults([]);
    }
  };

  return (
    <div className="location-card">
      <div className="location-header">
        <h4>
          <FaMapMarkerAlt /> Location
        </h4>
        <p className="subtext">Set your delivery or discovery area</p>
      </div>

      {/* 🔍 Search Input */}
      <div className="location-search-box">
        <FaSearch className="search-icon" />
        <input
          type="text"
          placeholder="Search location..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      {/* 📍 Search Results Dropdown */}
      {searchResults.length > 0 && (
        <ul className="location-dropdown">
          {searchResults.map((place, index) => (
            <li
              key={index}
              onClick={() => {
                setLocation(place.shortName);
                setSearchResults([]);
                setSearchQuery("");
              }}
            >
              {place.shortName}
            </li>
          ))}
        </ul>
      )}

      {/* 🗺️ Current Location */}
      <div className="current-location">
        <p>
          <strong>Current:</strong> {loading ? "Detecting..." : location}
        </p>
        <button onClick={detectLocation} className="detect-btn">
          <FaLocationArrow /> Use My Location
        </button>
      </div>
    </div>
  );
}

export default Filter;
